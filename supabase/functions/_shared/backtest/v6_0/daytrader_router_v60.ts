// supabase/functions/_shared/backtest/v6_0/daytrader_router_v60.ts
//
// Maps tickers to behavior types and internal v6.0 DAYTRADER engine IDs.

import { DayBehaviorType, getDayBehaviorType } from "./daytrader_behavior_classifier.ts";

export type DayEngineIdV60 =
  | "ENGINE_TREND"
  | "ENGINE_RANGE"
  | "ENGINE_VOLATILE"
  | "ENGINE_NONE";

export interface DayEngineContextV60 {
  ticker: string;
  behavior: DayBehaviorType;
  engineId: DayEngineIdV60;
}

export function getDayEngineIdForTicker(ticker: string): DayEngineIdV60 {
  const behavior = getDayBehaviorType(ticker);

  if (behavior === "BLACKLIST") return "ENGINE_NONE";
  if (behavior === "TREND")     return "ENGINE_TREND";
  if (behavior === "RANGE")     return "ENGINE_RANGE";
  if (behavior === "VOLATILE")  return "ENGINE_VOLATILE";

  return "ENGINE_TREND";
}

export function buildDayEngineContextV60(ticker: string): DayEngineContextV60 {
  const behavior = getDayBehaviorType(ticker);
  const engineId = getDayEngineIdForTicker(ticker);
  return { ticker, behavior, engineId };
}
