import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || '').toUpperCase();
    if (!symbol) return NextResponse.json({ error: 'MISSING_SYMBOL' }, { status: 400 });

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (!DEV_FORCE_PRO) {
      if (sessionError || !session) return NextResponse.json({ access: { is_locked: true } }, { status: 403 });
      const userId = session.user.id;
      const { data: subStatus } = await supabase.from('subscription_status').select('tier').eq('user_id', userId).maybeSingle();
      const isPro = subStatus?.tier === 'pro';
      if (!isPro) return NextResponse.json({ access: { is_locked: true } }, { status: 403 });
    }

    const { data: quotesData, error: quotesError } = await supabase.functions.invoke('get_quote_bulk', { body: { symbol } });
    if (quotesError) throw quotesError;
    const quote = quotesData?.quotes?.[0];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const token = session?.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticker: symbol, range: '1d', interval: '5m' }),
    });
    const chart = await resp.json();
    const closes: number[] = Array.isArray(chart?.closes) ? chart.closes : [];
    const spark = closes.slice(-12);

    return NextResponse.json(
      {
        symbol,
        name: symbol,
        price: quote?.price ?? null,
        pctChange: quote?.changePercent ?? null,
        sparklinePoints: spark,
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    );
  } catch (error: any) {
    console.error('[price-data] error', error);
    return NextResponse.json({ error: 'SYSTEM_ERROR', message: error.message || 'Failed' }, { status: 500 });
  }
}