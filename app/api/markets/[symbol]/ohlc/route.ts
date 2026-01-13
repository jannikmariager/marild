import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

// Timeframe options are TradingView-style candle intervals.
// We also choose a sensible default history range for each.
const VALID_TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'] as const;
export type Timeframe = (typeof VALID_TIMEFRAMES)[number];

function mapTimeframe(timeframe: Timeframe): { range: string; interval: string } {
  switch (timeframe) {
    case '5m':
      // Intraday scalping view – last few days of 5m bars
      return { range: '5d', interval: '5m' };
    case '15m':
      // Short-term intraday/2–3 week view
      return { range: '1mo', interval: '15m' };
    case '30m':
      // Swing intraday – last few months with 30m bars
      return { range: '3mo', interval: '30m' };
    case '1h':
      // 1h swing view – roughly 6 months
      return { range: '6mo', interval: '1h' };
    case '4h':
      // Higher timeframe view – about 1 year of 4h candles
      return { range: '1y', interval: '4h' };
    case '1D':
      // Classic daily chart – about 1 year of daily bars
      return { range: '1y', interval: '1d' };
    case '1W':
      // Weekly candles – multi-year perspective
      return { range: '2y', interval: '1wk' };
    case '1M':
      // Monthly candles – long-term view
      return { range: '5y', interval: '1mo' };
    default:
      // Fallback to daily chart if something unexpected comes in
      return { range: '1y', interval: '1d' };
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  try {
    const supabase = await createClient();
    const params = await context.params;

    // Derive symbol from either params or URL path as fallback
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const marketsIndex = segments.indexOf('markets');
    const fromPath = marketsIndex >= 0 && segments.length > marketsIndex + 1
      ? segments[marketsIndex + 1]
      : '';

    const rawSymbol = params?.symbol ?? fromPath ?? '';
    const symbol = rawSymbol.toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: 'MISSING_SYMBOL' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const tf = (searchParams.get('timeframe') || '1D').toUpperCase() as Timeframe;
    const timeframe = VALID_TIMEFRAMES.includes(tf) ? tf : '1D';
    const { range, interval } = mapTimeframe(timeframe);

    // Chart is FREE for all users: no auth required
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const token = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ticker: symbol, range, interval }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      console.error('[ohlc] edge error', errorData);
      return NextResponse.json({ error: 'CHART_ERROR' }, { status: 502 });
    }

    const data = await resp.json();
    const timestamps: number[] = data.timestamps || [];
    const opens: number[] = data.opens || [];
    const highs: number[] = data.highs || [];
    const lows: number[] = data.lows || [];
    const closes: number[] = data.closes || [];
    const volumes: number[] = data.volumes || [];

    const candles = timestamps.map((ts, i) => ({
      timestamp: ts,
      open: opens[i] ?? null,
      high: highs[i] ?? null,
      low: lows[i] ?? null,
      close: closes[i] ?? null,
      volume: volumes[i] ?? null,
    })).filter((c) => c.open != null && c.high != null && c.low != null && c.close != null);

    return NextResponse.json(
      {
        symbol,
        timeframe,
        candles,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=900, stale-while-revalidate=120',
        },
      }
    );
  } catch (error: any) {
    console.error('[markets ohlc] error', error);
    return NextResponse.json(
      { error: 'SYSTEM_ERROR', message: error.message || 'Failed to fetch OHLC' },
      { status: 500 }
    );
  }
}
