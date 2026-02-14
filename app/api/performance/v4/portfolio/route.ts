import { NextRequest, NextResponse } from "next/server";
import type { BacktestEngineType } from "@/lib/backtest/types_v4";
import { getHorizonForEngine, type EngineType } from "@/lib/backtest/horizon";
import {
  EquityPoint,
  normalizeCurve,
  mergeCurves,
  computeDrawdown,
  computeVolatility,
  computeRStats,
} from "@/lib/performance/equity_utils";

interface BacktestV4Result {
  symbol: string;
  timeframe_used: string;
  bars_loaded: number;
  trades_total: number;
  win_rate: number;
  avg_r: number;
  max_drawdown: number;
  fallback_used: boolean;
  anomalies: string[];
  stats_full?: {
    trades_total: number;
    win_rate: number;
    avg_r: number;
    max_drawdown: number;
    best_trade_r: number | null;
    worst_trade_r: number | null;
    equity_curve: Array<{ t: number; balance: number }>;
  };
  trades?: Array<{
    rMultiple: number;
  }>;
}

interface PortfolioResponse {
  portfolio_equity: EquityPoint[];
  benchmark_equity: EquityPoint[];
  tickers: Array<{
    ticker: string;
    equity: EquityPoint[];
    trades: number;
    win_rate: number;
    expectancy: number;
    sqn: number;
  }>;
  metrics: {
    final_return: number;
    profit_factor: number;
    expectancy: number;
    sqn: number;
    volatility: number;
  };
}

async function fetchBacktests(
  req: NextRequest,
  tickers: string[],
  engineType: EngineType,
  horizonDays: number,
): Promise<BacktestV4Result[]> {
  const url = new URL("/api/backtest/v4", req.url);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      engine_type: engineType,
      horizon_days: horizonDays,
      tickers,
    }),
  });

  const json = await res.json().catch(() => null as any);
  if (!res.ok || !json || !Array.isArray(json.results)) {
    throw new Error(json?.error ?? `Backtest V4 failed with status ${res.status}`);
  }

  return json.results as BacktestV4Result[];
}

export async function POST(req: NextRequest) {
  try {
    try {
      const { requireActiveEntitlement } = await import('@/app/api/_lib/entitlement');
      await requireActiveEntitlement(req);
    } catch (resp: any) {
      if (resp instanceof Response) {
        return resp as any;
      }
      throw resp;
    }
    const body = (await req.json()) as {
      tickers?: string[];
      engineType?: BacktestEngineType;
    };

    const userTickers = (body.tickers ?? []).map((t) => t.toUpperCase());
    const engineType = body.engineType as EngineType | undefined;

    if (!engineType || userTickers.length === 0) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const horizonDays = getHorizonForEngine(engineType);

    // 1) Fetch per-ticker backtests
    const backtests = await fetchBacktests(req, userTickers, engineType, horizonDays);

    // 2) Normalize equity curves to 100
    const perTickerNormalized: Array<{
      ticker: string;
      curve: EquityPoint[];
      rValues: number[];
      trades: number;
      win_rate: number;
    }> = [];

    for (const r of backtests) {
      const stats = r.stats_full ?? (r as any).stats ?? {};
      const eq = (stats.equity_curve as Array<{ t: number; balance: number }> | undefined) ?? [];
      if (!eq.length) continue;

      const curve: EquityPoint[] = eq.map((p) => ({ t: p.t, v: p.balance }));
      const norm = normalizeCurve(curve);

      const trades = r.trades ?? [];
      const rValues: number[] = Array.isArray(trades) ? trades.map((t) => t.rMultiple ?? 0) : [];

      perTickerNormalized.push({
        ticker: r.symbol,
        curve: norm,
        rValues,
        trades: r.trades_total ?? trades.length,
        win_rate: stats.win_rate ?? r.win_rate ?? 0,
      });
    }

    if (!perTickerNormalized.length) {
      return NextResponse.json(
        { error: "NO_DATA", message: "No usable V4 equity curves for requested tickers" },
        { status: 400 },
      );
    }

    // 3) Compute common timestamp grid (intersection / union simplified as union)
    const allTs = new Set<number>();
    for (const item of perTickerNormalized) {
      for (const p of item.curve) allTs.add(p.t);
    }
    const timestamps = Array.from(allTs).sort((a, b) => a - b);

    // 4) Merge per-ticker curves into portfolio curve (average across normalized series)
    const curves = perTickerNormalized.map((i) => i.curve);
    const portfolioCurve = mergeCurves(curves, timestamps);

    // 5) Fetch SPY benchmark for same engine/horizon and normalize
    const benchmarkBacktests = await fetchBacktests(req, ["SPY"], engineType, horizonDays);
    const spy = benchmarkBacktests[0];
    let benchmarkCurve: EquityPoint[] = [];
    if (spy) {
      const stats = spy.stats_full ?? (spy as any).stats ?? {};
      const eq = (stats.equity_curve as Array<{ t: number; balance: number }> | undefined) ?? [];
      const raw = eq.map((p) => ({ t: p.t, v: p.balance }));
      const norm = normalizeCurve(raw);
      benchmarkCurve = mergeCurves([norm], timestamps);
    }

    // 6) Portfolio-level metrics
    const finalReturn = portfolioCurve.length
      ? ((portfolioCurve[portfolioCurve.length - 1].v / portfolioCurve[0].v) - 1) * 100
      : 0;
    const volatility = computeVolatility(portfolioCurve);

    // Aggregate R values across all tickers
    const allR: number[] = [];
    for (const item of perTickerNormalized) allR.push(...item.rValues);
    const { expectancy, sqn, profitFactor } = computeRStats(allR);

    const perTicker = perTickerNormalized.map((item) => {
      const { expectancy, sqn } = computeRStats(item.rValues);
      return {
        ticker: item.ticker,
        equity: item.curve,
        trades: item.trades,
        win_rate: item.win_rate,
        expectancy,
        sqn,
      };
    });

    const response: PortfolioResponse = {
      portfolio_equity: portfolioCurve,
      benchmark_equity: benchmarkCurve,
      tickers: perTicker,
      metrics: {
        final_return: finalReturn,
        profit_factor: profitFactor,
        expectancy,
        sqn,
        volatility,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error("[/api/performance/v4/portfolio] Unexpected error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
