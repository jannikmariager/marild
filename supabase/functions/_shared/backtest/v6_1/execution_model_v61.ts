// supabase/functions/_shared/backtest/v6_1/execution_model_v61.ts
//
// EXECUTION MODEL V6.1 - Multi-engine DAYTRADER system (experimental).
//
// Mirrors the v6.0 architecture but calls the tuned v6.1 micro-engines.

import type { EngineType, FundamentalsData, OHLCBar } from "../../signal_types.ts";
import { buildDayEngineContextV60 } from "../v6_0/daytrader_router_v60.ts";
import {
  runTrendDaytraderV61,
  type ExecutionResultV61,
  type TradeV61,
} from "./trend_daytrader_v61.ts";
import { runRangeDaytraderV61 } from "./range_daytrader_v61.ts";
import { runVolatileDaytraderV61 } from "./volatile_daytrader_v61.ts";

export interface BacktestStatsV61 {
  trades_total: number;
  win_rate: number;
  avg_r: number;
  max_drawdown: number;
  best_trade_r: number | null;
  worst_trade_r: number | null;
  filtered_signals?: number;
  total_signals?: number;
  filter_reasons?: Record<string, number>;
  metadata?: {
    engine_version: string;
    behavior: string;
    engine_id: string;
    regime?: string;
    volatility_state?: string;
  };
}

export interface BacktestResultV61 {
  symbol: string;
  timeframe_used: string;
  bars_loaded: number;
  trades: TradeV61[];
  stats: BacktestStatsV61 & { equity_curve: Array<{ t: number; balance: number }> };
  anomalies: string[];
}

export interface BacktestConfigV61 {
  engine_type: EngineType;
  engine_version: "V3" | "V3_5" | "V4" | "V4_1";
  symbol: string;
  timeframe: string;
  starting_equity?: number;
}

export async function runExecutionModelV61(
  engineType: EngineType,
  symbol: string,
  timeframe: string,
  bars: OHLCBar[],
  startingEquity: number,
  fundamentals?: FundamentalsData,
): Promise<ExecutionResultV61> {
  const anomalies: string[] = [];

  if (!bars || bars.length < 2) {
    return {
      trades: [],
      equityCurve: [],
      filteredSignals: 0,
      totalSignals: 0,
      filterReasons: {},
      lastMetadata: {
        engine_version: "v6.1/none",
        behavior: "TREND",
        engine_id: "ENGINE_NONE",
      },
    };
  }

  // v6.1 is DAYTRADER-only; other styles should be routed via v4.9/v5.0.
  if (engineType !== "DAYTRADER") {
    return {
      trades: [],
      equityCurve: [
        { t: new Date(bars[0].timestamp).getTime(), balance: startingEquity },
        { t: new Date(bars[bars.length - 1].timestamp).getTime(), balance: startingEquity },
      ],
      filteredSignals: 0,
      totalSignals: 0,
      filterReasons: { not_daytrader_v61: 1 },
      lastMetadata: {
        engine_version: "v6.1/none",
        behavior: "TREND",
        engine_id: "ENGINE_NONE",
      },
    };
  }

  const ctx = buildDayEngineContextV60(symbol);

  if (ctx.engineId === "ENGINE_NONE") {
    return {
      trades: [],
      equityCurve: [
        { t: new Date(bars[0].timestamp).getTime(), balance: startingEquity },
        { t: new Date(bars[bars.length - 1].timestamp).getTime(), balance: startingEquity },
      ],
      filteredSignals: 0,
      totalSignals: 0,
      filterReasons: { blacklisted_v61: 1 },
      lastMetadata: {
        engine_version: "v6.1/none",
        behavior: ctx.behavior,
        engine_id: ctx.engineId,
      },
    };
  }

  let exec: ExecutionResultV61;

  if (ctx.engineId === "ENGINE_TREND") {
    exec = await runTrendDaytraderV61(engineType, symbol, bars, startingEquity, fundamentals, ctx);
  } else if (ctx.engineId === "ENGINE_RANGE") {
    exec = await runRangeDaytraderV61(engineType, symbol, bars, startingEquity, fundamentals, ctx);
  } else {
    exec = await runVolatileDaytraderV61(
      engineType,
      symbol,
      bars,
      startingEquity,
      fundamentals,
      ctx,
    );
  }

  return exec;
}

export function computeStatsV61(
  trades: TradeV61[],
  equityCurve: Array<{ t: number; balance: number }>,
  startingEquity: number,
  lastMetadata?: ExecutionResultV61["lastMetadata"],
): BacktestStatsV61 {
  const trades_total = trades.length;

  if (trades_total === 0) {
    return {
      trades_total: 0,
      win_rate: 0,
      avg_r: 0,
      max_drawdown: 0,
      best_trade_r: null,
      worst_trade_r: null,
      metadata: lastMetadata,
    };
  }

  const wins = trades.filter((t) => t.rMultiple > 0).length;
  const win_rate = (wins / trades_total) * 100;

  const rValues = trades.map((t) => t.rMultiple);
  const avg_r = rValues.reduce((s, r) => s + r, 0) / rValues.length;
  const best_trade_r = Math.max(...rValues);
  const worst_trade_r = Math.min(...rValues);

  let max_drawdown = 0;
  let peak = startingEquity;
  for (const pt of equityCurve) {
    if (pt.balance > peak) peak = pt.balance;
    const dd = peak > 0 ? ((peak - pt.balance) / peak) * 100 : 0;
    if (dd > max_drawdown) max_drawdown = dd;
  }

  return {
    trades_total,
    win_rate,
    avg_r,
    max_drawdown,
    best_trade_r,
    worst_trade_r,
    metadata: lastMetadata,
  };
}
