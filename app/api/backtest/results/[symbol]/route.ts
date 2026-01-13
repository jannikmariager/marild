import { NextRequest, NextResponse } from "next/server";
import type { BacktestResult, BacktestResultsPayload, BacktestResultStats } from "@/lib/backtest/types_results";
import { BACKTEST_VERSION } from "@/lib/backtest/version";

const BUCKET_NAME = "backtests";

type Mode = "day" | "swing" | "invest";

async function loadMode(
  supabaseUrl: string,
  symbol: string,
  mode: Mode,
): Promise<BacktestResult | null> {
  // Use public URL to fetch from public bucket
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/v4.6/${symbol}/${mode}.json`;

  try {
    const response = await fetch(publicUrl, { 
      next: { revalidate: 300 } // Cache for 5 minutes
    });
    
    if (!response.ok) {
      console.warn(`[backtest-results] Missing ${mode} file for ${symbol}: ${response.status}`);
      return null;
    }

    const raw = await response.json();

    const statsRaw: any = raw.stats ?? {};
    const stats: BacktestResultStats = {
      trades_total: Number(statsRaw.trades_total ?? 0),
      win_rate: Number(statsRaw.win_rate ?? 0),
      avg_r: Number(statsRaw.avg_r ?? 0),
      max_drawdown: Number(statsRaw.max_drawdown ?? 0),
      best_trade_r: statsRaw.best_trade_r ?? null,
      worst_trade_r: statsRaw.worst_trade_r ?? null,
      equity_curve: statsRaw.equity_curve ?? [],
    };

    const trades = Array.isArray(raw.trades) ? raw.trades : [];
    const anomalies: string[] = Array.isArray(raw.anomalies)
      ? raw.anomalies
      : raw.anomalies
      ? [String(raw.anomalies)]
      : [];

    const result: BacktestResult = {
      timeframe_used: String(raw.timeframe_used ?? ""),
      bars_loaded: Number(raw.bars_loaded ?? 0),
      stats,
      trades,
      anomalies,
    };

    return result;
  } catch (err) {
    console.error(`[backtest-results] Error loading ${mode} for ${symbol}:`, err);
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const resolvedParams = await params;
  const rawSymbol = resolvedParams.symbol ?? "";
  const symbol = rawSymbol.trim().toUpperCase();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    console.error("[backtest-results] Missing NEXT_PUBLIC_SUPABASE_URL");
    const payload: BacktestResultsPayload = {
      symbol,
      version: `V${BACKTEST_VERSION}`,
      day: null,
      swing: null,
      invest: null,
    };
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }

  const [day, swing, invest] = await Promise.all<BacktestResult | null | undefined>([
    loadMode(supabaseUrl, symbol, "day"),
    loadMode(supabaseUrl, symbol, "swing"),
    loadMode(supabaseUrl, symbol, "invest"),
  ]);

  const payload: BacktestResultsPayload = {
    symbol,
    version: `V${BACKTEST_VERSION}`,
    day: day ?? null,
    swing: swing ?? null,
    invest: invest ?? null,
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
