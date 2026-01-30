/**
 * BACKTEST ENGINE V4 - CORE
 *
 * High-level orchestration:
 * - Accept sanitized OHLC bars (from unified loader)
 * - Run single-position execution model
 * - Compute summary statistics and equity curve
 *
 * This module does NOT perform OHLC loading itself; callers should use
 * loadUnifiedOHLC / loadMassiveOHLC and sanitizeBars() before invoking.
 */

import {
  EngineType,
  FundamentalsData,
  OHLCBar,
} from "../../signal_types.ts";
import { sanitizeBars } from "./ohlc_windowing.ts";
import { runExecutionModel, TradeV4, ExecutionResult } from "./execution_model.ts";

export interface BacktestStatsV4 {
  trades_total: number;
  win_rate: number;
  avg_r: number;
  max_drawdown: number;
  best_trade_r: number | null;
  worst_trade_r: number | null;
  filtered_signals?: number;
  total_signals?: number;
  filter_reasons?: Record<string, number>;
}

export interface BacktestResultV4 {
  symbol: string;
  timeframe_used: string;
  bars_loaded: number;
  trades: TradeV4[];
  stats: BacktestStatsV4 & { equity_curve: Array<{ t: number; balance: number }> };
  anomalies: string[];
}

export interface BacktestConfigV4 {
  engine_type: EngineType;
  engine_version: 'V3' | 'V3_5' | 'V4' | 'V4_1';
  symbol: string;
  timeframe: string;
  starting_equity?: number;
}

export async function runBacktestV4(
  config: BacktestConfigV4,
  rawBars: OHLCBar[],
  fundamentals?: FundamentalsData,
): Promise<BacktestResultV4> {
  const { engine_type, engine_version, symbol, timeframe } = config;
  const startingEquity = config.starting_equity ?? 100_000;

  // 1. Sanitize bars and collect anomalies
  const { bars, anomalies, insufficient } = sanitizeBars(engine_type, rawBars);

  if (insufficient) {
    throw new Error(
      `[BacktestV4] INSUFFICIENT_DATA for ${symbol}/${timeframe}: ${bars.length} sanitized bars`,
    );
  }

  // 2. Run execution model
  const exec: ExecutionResult = await runExecutionModel(
    engine_type,
    engine_version,
    symbol,
    bars,
    startingEquity,
    fundamentals,
  );

  // 3. Compute stats
  const statsCore = computeStats(exec.trades, exec.equityCurve, startingEquity);

  const stats: BacktestStatsV4 & { equity_curve: Array<{ t: number; balance: number }> } = {
    ...statsCore,
    equity_curve: exec.equityCurve,
    filtered_signals: exec.filteredSignals,
    total_signals: exec.totalSignals,
    filter_reasons: exec.filterReasons,
  };

  return {
    symbol,
    timeframe_used: timeframe,
    bars_loaded: bars.length,
    trades: exec.trades,
    stats,
    anomalies,
  };
}

function computeStats(
  trades: TradeV4[],
  equityCurve: Array<{ t: number; balance: number }>,
  startingEquity: number,
): BacktestStatsV4 {
  const trades_total = trades.length;

  if (trades_total === 0) {
    return {
      trades_total: 0,
      win_rate: 0,
      avg_r: 0,
      max_drawdown: 0,
      best_trade_r: null,
      worst_trade_r: null,
    };
  }

  const wins = trades.filter((t) => t.rMultiple > 0).length;
  const win_rate = (wins / trades_total) * 100;

  const rValues = trades.map((t) => t.rMultiple);
  const avg_r = rValues.reduce((sum, r) => sum + r, 0) / rValues.length;
  const best_trade_r = Math.max(...rValues);
  const worst_trade_r = Math.min(...rValues);

  // Max drawdown from equity curve
  let max_drawdown = 0;
  let peak = startingEquity;
  for (const point of equityCurve) {
    if (point.balance > peak) peak = point.balance;
    const dd = peak > 0 ? ((peak - point.balance) / peak) * 100 : 0;
    if (dd > max_drawdown) max_drawdown = dd;
  }

  return {
    trades_total,
    win_rate,
    avg_r,
    max_drawdown,
    best_trade_r,
    worst_trade_r,
  };
}
