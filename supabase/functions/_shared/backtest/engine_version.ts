// supabase/functions/_shared/backtest/engine_version.ts
//
// High-level backtest engine label used by local/cloud runners and the
// webapp to decide which V4/V5 generation is considered "current".
//
// IMPORTANT: This does not replace the internal engine_version flag used
// by the V4 core (V3/V3_5/V4/V4_1). It sits one level above that and is
// used only to select between the frozen v4.6 baseline, research clones,
// and newer v5.x engines.

import type { EngineType } from "../signal_types.ts";
import type { HighLevelEngineVersion } from "./v4_router.ts";

export type CurrentBacktestEngine = "v4.6" | "v4.7" | "v4.8" | "v4.9" | "v5.0";

// Historical default; callers that do not use getEngineVersionForStyle
// will fall back to this when BACKTEST_ENGINE env is not set.
export const CURRENT_BACKTEST_ENGINE: CurrentBacktestEngine = "v4.7";

// Per-style high-level engine selection for backtests.
//
// DAYTRADER  → v5.0_wrapped (v5.0 core with WHITELIST/BLACKLIST + limits)
// SWING      → v4.9
// INVESTOR   → v4.9
export function getEngineVersionForStyle(engineType: EngineType): HighLevelEngineVersion {
  if (engineType === "DAYTRADER") return "v5.0_wrapped";
  if (engineType === "SWING") return "v4.9";
  if (engineType === "INVESTOR") return "v4.9";
  return CURRENT_BACKTEST_ENGINE as HighLevelEngineVersion;
}
