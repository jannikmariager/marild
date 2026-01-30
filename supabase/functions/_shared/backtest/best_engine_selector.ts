// supabase/functions/_shared/backtest/best_engine_selector.ts
//
// Backend helper for future hybrid routing: given per-ticker
// engine_comparison_results-style rows, pick the best DAYTRADER engine.
//
// NOTE: This is not wired into live routing yet. It is intended to be used
// by offline jobs to precompute per-ticker overrides (e.g. V5.0 vs V6.1).

import type { HighLevelEngineVersion } from "./v4_router.ts";

export type EngineComparisonRow = {
  ticker: string;
  timeframe: "day" | "swing" | "invest";
  version: string; // e.g. "V4.9", "V5.0", "V6.0", "V6.1"
  avgR: number;
  trades: number;
  winRate: number;
  maxDrawdown: number;
};

export function pickBestEngineForDay(rows: EngineComparisonRow[]): string | null {
  const candidates = rows.filter((r) => {
    if (r.timeframe !== "day") return false;
    if (r.trades < 5) return false;
    if (r.avgR <= 0) return false;
    if (r.winRate < 40) return false;
    if (r.maxDrawdown > 25) return false;
    return true;
  });

  if (!candidates.length) return null;

  const sorted = [...candidates].sort((a, b) => b.avgR - a.avgR);
  return sorted[0].version;
}
