// supabase/functions/_shared/backtest/v4_router.ts
//
// Thin router that selects between the frozen V4.6 baseline implementation,
// the V4.7 research clone, the modular V4.8 SMC engine, and the tuned-filter V4.9 variant.
// All cores share the same public API (BacktestConfigV4, BacktestResultV4).
//
import type { OHLCBar } from "../signal_types.ts";
import { runBacktestV4 as runV46, type BacktestConfigV4, type BacktestResultV4 } from "./v4/backtest_engine_v4.ts";
import { runBacktestV4 as runV47 } from "./v4_7/backtest_engine_v4.ts";
import { runBacktestV4 as runV48 } from "./v4_8/backtest_engine_v4.ts";
import { runBacktestV4 as runV49 } from "./v4_9/backtest_engine_v4.ts";
import { runBacktestV5 as runV50 } from "./v5_0/backtest_engine_v5.ts";
import { runBacktestV51 as runV51 } from "./v5_1/backtest_engine_v5.ts";
import { runBacktestV60 } from "./v6_0/backtest_engine_v6.ts";
import { runBacktestV61 } from "./v6_1/backtest_engine_v6_1.ts";
import { runBacktestV50Wrapped } from "./daytrader_v50_wrapped.ts";

export type HighLevelEngineVersion =
  | "v4.6"
  | "v4.7"
  | "v4.8"
  | "v4.9"
  | "v5.0"
  | "v5.0_wrapped"
  | "v5.1"
  | "v6.0"
  | "v6.1";

export async function runBacktestV4Router(
  version: HighLevelEngineVersion,
  config: BacktestConfigV4,
  bars: OHLCBar[],
): Promise<BacktestResultV4> {
  if (version === "v6.1") {
    // Route v6.1 requests to the tuned multi-engine DAYTRADER wrapper
    // @ts-ignore - compatible return shape with BacktestResultV4
    return await runBacktestV61({
      engine_type: config.engine_type,
      engine_version: config.engine_version,
      symbol: config.symbol,
      timeframe: config.timeframe,
      starting_equity: config.starting_equity,
    } as any, bars as any);
  }
  if (version === "v6.0") {
    // Route v6.0 requests to the multi-engine DAYTRADER wrapper
    // @ts-ignore - compatible return shape with BacktestResultV4
    return await runBacktestV60({
      engine_type: config.engine_type,
      engine_version: config.engine_version,
      symbol: config.symbol,
      timeframe: config.timeframe,
      starting_equity: config.starting_equity,
    } as any, bars as any);
  }
  if (version === "v5.1") {
    // Route v5.1 requests to the DAYTRADER-only tuned wrapper
    // @ts-ignore - compatible return shape
    return await runV51(config as any, bars);
  }
  if (version === "v5.0_wrapped") {
    // Route v5.0_wrapped requests through the DAYTRADER whitelist/blacklist
    // and safety limits wrapper (v5.0 core for DAYTRADER, v4.9 for SWING/INVESTOR).
    return await runBacktestV50Wrapped(config, bars);
  }
  if (version === "v5.0") {
    // Route v5.0 requests to the raw v5.0 wrapper; interface is identical
    // to earlier versions so callers remain unchanged.
    // @ts-ignore - compatible return shape
    return await runV50(config as any, bars);
  }
  if (version === "v4.9") {
    return await runV49(config, bars);
  }
  if (version === "v4.8") {
    return await runV48(config, bars);
  }
  if (version === "v4.7") {
    return await runV47(config, bars);
  }
  // Default to v4.6 baseline
  return await runV46(config, bars);
}
