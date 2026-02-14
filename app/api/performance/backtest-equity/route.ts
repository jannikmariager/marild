import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const ENGINE_TYPE_BY_HORIZON: Record<string, string> = {
  day: 'DAYTRADER',
  swing: 'SWING',
  invest: 'INVESTOR',
};

const TIMEFRAME_BY_HORIZON: Record<string, string> = {
  day: '5m',
  swing: '4h',
  invest: '1d',
};

interface EquityPoint {
  date: string;
  equity: number;
}

interface BenchmarkResponse {
  symbol: string;
  equity_curve: EquityPoint[];
  final_return_pct: number;
}

async function buildBenchmarkCurve(
  symbol: string,
  equityCurve: EquityPoint[],
  startDate: string | null,
  endDate: string | null
): Promise<BenchmarkResponse | null> {
  if (!equityCurve.length) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const firstEquityDate = new Date(startDate || equityCurve[0].date);
  const lastEquityDate = new Date(endDate || equityCurve[equityCurve.length - 1].date);
  const diffDays = Math.max(
    1,
    Math.round((lastEquityDate.getTime() - firstEquityDate.getTime()) / (1000 * 60 * 60 * 24))
  );

  // Pick a Yahoo range large enough to cover the equity curve window
  let range: '6mo' | '1y' | '2y' | '5y' | 'max';
  if (diffDays <= 180) range = '6mo';
  else if (diffDays <= 365) range = '1y';
  else if (diffDays <= 730) range = '2y';
  else if (diffDays <= 1825) range = '5y';
  else range = 'max';

  const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ ticker: symbol, range, interval: '1d' }),
  });

  if (!resp.ok) {
    console.error('[backtest-equity] benchmark fetch failed', symbol, await resp.text());
    return null;
  }

  const chart = await resp.json();
  const timestamps: number[] = chart?.timestamps || [];
  const closes: number[] = chart?.closes || [];
  if (!timestamps.length || !closes.length) return null;

  const daily = timestamps.map((ts, i) => ({
    t: ts * 1000,
    close: closes[i],
  })).sort((a, b) => a.t - b.t);

  // Walk through equity curve dates and map to step-wise benchmark closes
  const startEquity = equityCurve[0].equity ?? 100000;
  let j = 0;
  let lastClose = daily[0].close;

  const firstDateMs = new Date(equityCurve[0].date).getTime();
  while (j < daily.length && daily[j].t <= firstDateMs) {
    if (daily[j].close != null) lastClose = daily[j].close;
    j++;
  }
  const firstClose = lastClose;
  if (!firstClose || !Number.isFinite(firstClose)) return null;

  j = 0;
  const benchCurve: EquityPoint[] = [];
  for (const pt of equityCurve) {
    const tMs = new Date(pt.date).getTime();
    while (j < daily.length && daily[j].t <= tMs) {
      if (daily[j].close != null) lastClose = daily[j].close;
      j++;
    }
    const close = lastClose || firstClose;
    const eq = (startEquity * close) / firstClose;
    benchCurve.push({ date: pt.date, equity: eq });
  }

  const finalReturnPct = benchCurve.length
    ? ((benchCurve[benchCurve.length - 1].equity - benchCurve[0].equity) / benchCurve[0].equity) * 100
    : 0;

  return {
    symbol,
    equity_curve: benchCurve,
    final_return_pct: finalReturnPct,
  };
}

export async function GET(request: Request) {
  try {
    try {
      const { requireActiveEntitlement } = await import('@/app/api/_lib/entitlement');
      await requireActiveEntitlement(request as any);
    } catch (resp: any) {
      if (resp instanceof Response) {
        return resp as any;
      }
      throw resp;
    }
    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker');
    const horizon = url.searchParams.get('horizon') ?? 'swing';

    if (!ticker) {
      return NextResponse.json(
        { error: 'MISSING_TICKER', message: 'ticker parameter is required' },
        { status: 400 }
      );
    }

    const engineType = ENGINE_TYPE_BY_HORIZON[horizon] ?? 'SWING';
    const timeframe = TIMEFRAME_BY_HORIZON[horizon] ?? '4h';

    const supabase = await createClient();

    const { data, error } = await supabase
      .from('backtest_results')
      .select('equity_curve, starting_equity, ending_equity, total_return_pct, max_drawdown_pct, start_date, end_date')
      .eq('engine_type', engineType)
      .eq('symbol', ticker.toUpperCase())
      .eq('timeframe', timeframe)
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[performance/backtest-equity] query error', error);
      return NextResponse.json(
        { error: 'QUERY_ERROR', message: 'Failed to load backtest equity curve' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ equity_curve: [], meta: null, benchmarks: null });
    }

    const equityCurve = (data.equity_curve || []) as EquityPoint[];

    // Build SPY/QQQ benchmarks for day + swing horizons (invest less relevant intraday)
    let benchmarks: { SPY?: BenchmarkResponse | null; QQQ?: BenchmarkResponse | null } | null = null;
    if (equityCurve.length && (horizon === 'swing' || horizon === 'day')) {
      try {
        const [spy, qqq] = await Promise.all([
          buildBenchmarkCurve('SPY', equityCurve, data.start_date, data.end_date),
          buildBenchmarkCurve('QQQ', equityCurve, data.start_date, data.end_date),
        ]);
        benchmarks = { SPY: spy, QQQ: qqq };
      } catch (e) {
        console.warn('[performance/backtest-equity] benchmark build failed', e);
      }
    }

    return NextResponse.json({
      equity_curve: equityCurve,
      meta: {
        starting_equity: data.starting_equity,
        ending_equity: data.ending_equity,
        total_return_pct: data.total_return_pct,
        max_drawdown_pct: data.max_drawdown_pct,
        start_date: data.start_date,
        end_date: data.end_date,
      },
      benchmarks,
    });
  } catch (error) {
    console.error('[performance/backtest-equity] unexpected error', error);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Failed to load backtest equity curve' },
      { status: 500 }
    );
  }
}
