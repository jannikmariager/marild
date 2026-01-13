import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

// Lightweight multi-symbol pricing endpoint
// Example: /api/prices?symbols=AAPL,TSLA,SOXL

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    if (!symbolsParam) {
      return NextResponse.json({ error: 'MISSING_SYMBOLS' }, { status: 400 });
    }

    const symbols = symbolsParam
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Require logged-in user but DO NOT PRO-gate
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    // Fetch quotes in bulk via Edge Function (cached upstream)
    const { data: quotesData, error: quotesError } = await supabase.functions.invoke('get_quote_bulk', {
      body: { symbols },
    });

    if (quotesError) {
      throw quotesError;
    }

    const quotes = quotesData?.quotes || [];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const token = session.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const results = await Promise.all(
      quotes.map(async (q: any) => {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ ticker: q.symbol, range: '1d', interval: '5m' }),
          });

          const chart = await resp.json();
          const closes: number[] = Array.isArray(chart?.closes) ? chart.closes : [];
          const spark = closes.slice(-30); // small 30-point sparkline

          return {
            symbol: q.symbol,
            price: q.price ?? null,
            changePct: q.changePercent ?? null,
            volume: q.volume ?? null,
            sparkline: spark.length > 0 ? spark : null,
            updatedAt: new Date().toISOString(),
          };
        } catch {
          return {
            symbol: q.symbol,
            price: q.price ?? null,
            changePct: q.changePercent ?? null,
            volume: q.volume ?? null,
            sparkline: null,
            updatedAt: new Date().toISOString(),
          };
        }
      })
    );

    return NextResponse.json(results, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=60',
      },
    });
  } catch (error: any) {
    console.error('[prices] error', error);
    return NextResponse.json(
      { error: 'SYSTEM_ERROR', message: error.message || 'Failed to load prices' },
      { status: 500 }
    );
  }
}
