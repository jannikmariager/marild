import { NextRequest, NextResponse } from "next/server";
import type { BacktestEngineType } from "@/lib/backtest/types_v4";
import { getHorizonForEngine, type EngineType } from "@/lib/backtest/horizon";

interface PerformanceV4ApiItem {
  ticker: string;
  timeframe_used: string;
  bars_loaded: number;
  trades: number;
  win_rate: number;
  avg_return: number;
  max_drawdown: number;
  equity_curve: Array<{ t: number; v: number }>;
  anomalies: string[];
  fallback_used: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      tickers?: string[];
      engineType?: BacktestEngineType;
    };

    const tickers = body.tickers ?? [];
    const engineType = body.engineType as EngineType | undefined;

    if (!engineType || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const horizonDays = getHorizonForEngine(engineType);

    const url = new URL("/api/backtest/v4", req.url);

    const backtestRes = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine_type: engineType,
        horizon_days: horizonDays,
        tickers,
      }),
    });

    const backtestJson = await backtestRes.json().catch(() => null);

    if (!backtestRes.ok || !backtestJson || !Array.isArray(backtestJson.results)) {
      return NextResponse.json(
        { error: "BACKTEST_V4_ERROR", details: backtestJson?.error ?? backtestJson },
        { status: 500 },
      );
    }

    const items: PerformanceV4ApiItem[] = (backtestJson.results as any[]).map((r) => {
      const stats = r.stats_full ?? r.stats ?? {};
      const equityCurve = (stats.equity_curve as Array<{ t: number; balance: number }> | undefined) ?? [];

      return {
        ticker: r.symbol ?? r.ticker,
        timeframe_used: r.timeframe_used ?? "",
        bars_loaded: r.bars_loaded ?? 0,
        trades: r.trades_total ?? (Array.isArray(r.trades) ? r.trades.length : 0),
        win_rate: stats.win_rate ?? r.win_rate ?? 0,
        avg_return: stats.avg_r ?? r.avg_r ?? 0,
        max_drawdown: stats.max_drawdown ?? r.max_drawdown ?? 0,
        equity_curve: equityCurve.map((p) => ({ t: p.t, v: p.balance })),
        anomalies: r.anomalies ?? [],
        fallback_used: r.fallback_used ?? false,
      };
    });

    return NextResponse.json(items, { status: 200 });
  } catch (err: any) {
    console.error("[/api/performance/v4] Unexpected error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
