import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser();
    const {
      data: sessionData,
    } = await supabase.auth.getSession();
    const session = sessionData?.session ?? null;

    if (!DEV_FORCE_PRO) {
      if (sessionError || !user) return NextResponse.json({ access: { is_locked: true } }, { status: 403 });
      const userId = user.id;
      const { data: subStatus } = await supabase.from('subscription_status').select('tier').eq('user_id', userId).maybeSingle();
      const isPro = subStatus?.tier === 'pro';
      if (!isPro) return NextResponse.json({ access: { is_locked: true } }, { status: 403 });
    }

    const userId = user?.id;
    // Only fetch pinned symbols for dashboard display
    const { data: symbols, error } = await supabase
      .from('user_watchlist')
      .select('symbol')
      .eq('user_id', userId)
      .eq('is_pinned', true)
      .order('order_index', { ascending: true })
      .limit(20);
    if (error) throw error;

    const list = (symbols || []).map((r: any) => r.symbol);
    if (list.length === 0) return NextResponse.json({ items: [], access: { is_locked: false }, updatedAt: new Date().toISOString() });

    const { data: quotesData, error: quotesError } = await supabase.functions.invoke('get_quote_bulk', { body: { symbols: list } });
    if (quotesError) throw quotesError;
    const quotes = quotesData?.quotes || [];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const token = session?.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const items = await Promise.all(
      quotes.map(async (q: any) => {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ticker: q.symbol, range: '1d', interval: '5m' }),
          });
          const chart = await resp.json();
          const closes: number[] = Array.isArray(chart?.closes) ? chart.closes : [];
          const spark = closes.slice(-12);

          // Optional name lookup
          let name: string | null = null;
          try {
            const prof = await fetch(`${supabaseUrl}/functions/v1/get_company_profile_v2`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ ticker: q.symbol }),
            });
            const profile = await prof.json();
            name = profile?.shortName || profile?.longName || null;
          } catch {}

          return {
            symbol: q.symbol,
            name: name || q.symbol,
            price: q.price,
            change: q.change || null,
            pctChange: q.changePercent,
            sparklinePoints: spark,
            volume: q.volume || null,
            updatedAt: new Date().toISOString(),
          };
        } catch (e) {
          return {
            symbol: q.symbol,
            name: q.symbol,
            price: q.price,
            change: q.change || null,
            pctChange: q.changePercent,
            sparklinePoints: [],
            volume: q.volume || null,
            updatedAt: new Date().toISOString(),
          };
        }
      })
    );

    return NextResponse.json(
      { items, access: { is_locked: false }, updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=60' } }
    );
  } catch (error: any) {
    console.error('[watchlist] error', error);
    return NextResponse.json({ error: 'SYSTEM_ERROR', message: error.message || 'Failed' }, { status: 500 });
  }
}

// Add symbol to watchlist
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const userId = user.id;
    const body = await request.json();
    const { symbol } = body;

    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json({ error: 'INVALID_SYMBOL' }, { status: 400 });
    }

    // Insert or ignore if exists
    const { error: insertError } = await supabase
      .from('user_watchlist')
      .upsert(
        { user_id: userId, symbol: symbol.toUpperCase(), added_at: new Date().toISOString() },
        { onConflict: 'user_id,symbol' }
      );

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, symbol: symbol.toUpperCase() });
  } catch (error: any) {
    console.error('[watchlist POST] error', error);
    return NextResponse.json({ error: 'SYSTEM_ERROR', message: error.message }, { status: 500 });
  }
}

// Remove symbol from watchlist
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const userId = user.id;
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
      return NextResponse.json({ error: 'INVALID_SYMBOL' }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from('user_watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('symbol', symbol.toUpperCase());

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true, symbol: symbol.toUpperCase() });
  } catch (error: any) {
    console.error('[watchlist DELETE] error', error);
    return NextResponse.json({ error: 'SYSTEM_ERROR', message: error.message }, { status: 500 });
  }
}
