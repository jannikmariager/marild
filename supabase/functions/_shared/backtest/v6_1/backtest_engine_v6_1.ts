// supabase/functions/_shared/backtest/v6_1/backtest_engine_v6_1.ts
//
// BACKTEST ENGINE V6.1 - wraps the multi-engine DAYTRADER execution model
// with the same public API shape as v4.x/v5.x backtest engines so the
// v4_router and tools can treat it uniformly.

import {
  EngineType,
  FundamentalsData,
  OHLCBar,
} from "../../signal_types.ts";
import { sanitizeBars } from "../v4_8/ohlc_windowing.ts";
import {
  runExecutionModelV61,
  computeStatsV61,
  type BacktestStatsV61,
  type BacktestResultV61,
  type BacktestConfigV61,
} from "./execution_model_v61.ts";

export type { BacktestStatsV61, BacktestResultV61, BacktestConfigV61 };

export async function runBacktestV61(
  config: BacktestConfigV61,
  rawBars: OHLCBar[],
  fundamentals?: FundamentalsData,
): Promise<BacktestResultV61> {
  const { engine_type, symbol, timeframe } = config;
  const startingEquity = config.starting_equity ?? 100_000;

  const { bars, anomalies, insufficient } = sanitizeBars(engine_type, rawBars);
  if (insufficient) {
    throw new Error(
      `[BacktestV6.1] INSUFFICIENT_DATA for ${symbol}/${timeframe}: ${bars.length} sanitized bars`,
    );
  }

  const exec = await runExecutionModelV61(
    engine_type,
    symbol,
    timeframe,
    bars,
    startingEquity,
    fundamentals,
  );

  const statsCore = computeStatsV61(exec.trades, exec.equityCurve, startingEquity, exec.lastMetadata);
  const stats: BacktestStatsV61 & { equity_curve: Array<{ t: number; balance: number }> } = {
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
