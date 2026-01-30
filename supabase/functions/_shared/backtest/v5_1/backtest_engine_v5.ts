/**
 * BACKTEST ENGINE V5.1 - CORE
 *
 * DAYTRADER-only tuning patch wrapper. Wraps v5.1 execution model with
 * the same public API as v4.x/v5.0 backtest engines.
 */

import {
  EngineType,
  FundamentalsData,
  OHLCBar,
} from "../../signal_types.ts";
import { sanitizeBars } from "../v4_8/ohlc_windowing.ts";
import { runExecutionModelV51, type ExecutionResultV5, type TradeV5 } from "./execution_model_v51.ts";

export interface BacktestStatsV5 {
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
    engine_version: 'v5.1';
    bos_displacement: boolean;
    orderblock_quality: boolean;
    trend_regime: string;
    volatility_state: string;
  };
}

export interface BacktestResultV5 {
  symbol: string;
  timeframe_used: string;
  bars_loaded: number;
  trades: TradeV5[];
  stats: BacktestStatsV5 & { equity_curve: Array<{ t: number; balance: number }> };
  anomalies: string[];
}

export interface BacktestConfigV5 {
  engine_type: EngineType;
  engine_version: 'V3' | 'V3_5' | 'V4' | 'V4_1';
  symbol: string;
  timeframe: string;
  starting_equity?: number;
}

export async function runBacktestV51(
  config: BacktestConfigV5,
  rawBars: OHLCBar[],
  fundamentals?: FundamentalsData,
): Promise<BacktestResultV5> {
  const { engine_type, symbol, timeframe } = config;
  const startingEquity = config.starting_equity ?? 100_000;

  const { bars, anomalies, insufficient } = sanitizeBars(engine_type, rawBars);
  if (insufficient) {
    throw new Error(`[BacktestV5.1] INSUFFICIENT_DATA for ${symbol}/${timeframe}: ${bars.length} sanitized bars`);
  }

  const exec: ExecutionResultV5 = await runExecutionModelV51(
    engine_type,
    symbol,
    bars,
    startingEquity,
    fundamentals,
  );

  const statsCore = computeStats(exec.trades, exec.equityCurve, startingEquity);
  const stats: BacktestStatsV5 & { equity_curve: Array<{ t: number; balance: number }> } = {
    ...statsCore,
    equity_curve: exec.equityCurve,
    filtered_signals: exec.filteredSignals,
    total_signals: exec.totalSignals,
    filter_reasons: exec.filterReasons,
    metadata: exec.lastMetadata ?? undefined,
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
  trades: TradeV5[],
  equityCurve: Array<{ t: number; balance: number }>,
  startingEquity: number,
): BacktestStatsV5 {
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
  const wins = trades.filter(t => t.rMultiple > 0).length;
  const win_rate = (wins / trades_total) * 100;
  const rValues = trades.map(t => t.rMultiple);
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

  return { trades_total, win_rate, avg_r, max_drawdown, best_trade_r, worst_trade_r };
}
