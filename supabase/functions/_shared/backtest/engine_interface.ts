// supabase/functions/_shared/backtest/engine_interface.ts
//
// Common interface that all backtest engines (v4.6 baseline, v4.7-alpha
// experiments, future V5, ...) must implement so the research harness can
// invoke them in a uniform way.

import type { EngineType, OHLCBar } from "../signal_types.ts";
import type {
  BacktestResult,
  BacktestHorizon,
} from "./backtest_result_schema.ts";

export type { BacktestHorizon } from "./backtest_result_schema.ts";

export interface EngineConfig {
  // Human-readable engine label used for storage paths, e.g. "v4.6" or
  // "v4.7-alpha".
  engineVersion: string;
  // Logical horizon the caller is running (day / swing / invest).
  horizon: BacktestHorizon;
  // Core execution profile. Engines are free to interpret this however
  // they like, but for the current V4.x generation this maps directly to
  // the DAYTRADER / SWING / INVESTOR engine types.
  engineType: EngineType;
  // Actual timeframe used for the OHLC bars (e.g. "1m", "4h", "1d").
  timeframe: string;
  // Optional starting equity; defaults to $100k when omitted.
  startingEquity?: number;
}

export interface EngineRunner {
  runBacktest(
    cfg: EngineConfig,
    symbol: string,
    bars: OHLCBar[],
  ): Promise<BacktestResult>;
}
