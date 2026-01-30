// supabase/functions/_shared/backtest/v6_0/daytrader_behavior_classifier.ts
//
// Simple hard-coded behavior profiles for v6.0 DAYTRADER routing.
// This will later be replaced or augmented by data-driven profiles.

export type DayBehaviorType = "TREND" | "RANGE" | "VOLATILE" | "BLACKLIST";

export interface DayTickerProfile {
  ticker: string;
  behavior: DayBehaviorType;
}

export const DAYTRADER_PROFILES_V60: DayTickerProfile[] = [
  // TREND names – strong intraday trends
  { ticker: "NVDA", behavior: "TREND" },
  { ticker: "TSLA", behavior: "TREND" },
  { ticker: "META", behavior: "TREND" },
  { ticker: "MSFT", behavior: "TREND" },
  { ticker: "AMD",  behavior: "TREND" },
  { ticker: "QQQ",  behavior: "TREND" },

  // RANGE / mean-reversion names
  { ticker: "SPY",  behavior: "RANGE" },
  { ticker: "DIA",  behavior: "RANGE" },
  { ticker: "KO",   behavior: "RANGE" },
  { ticker: "BA",   behavior: "RANGE" },
  { ticker: "XOM",  behavior: "RANGE" },
  { ticker: "CSCO", behavior: "RANGE" }, // worked well in v5.1

  // High-vol, breakout / momentum names
  { ticker: "MARA", behavior: "VOLATILE" },
  { ticker: "HUT",  behavior: "VOLATILE" },
  { ticker: "DUST", behavior: "VOLATILE" },
  { ticker: "BYND", behavior: "VOLATILE" },

  // Known toxic tickers for daytrading (from backtests)
  { ticker: "MDB",  behavior: "BLACKLIST" },
  { ticker: "UBER", behavior: "BLACKLIST" },
  { ticker: "NKE",  behavior: "BLACKLIST" },
  { ticker: "CLOV", behavior: "BLACKLIST" },
  { ticker: "BBBY", behavior: "BLACKLIST" },
];

export function getDayBehaviorType(ticker: string): DayBehaviorType {
  const match = DAYTRADER_PROFILES_V60.find(
    (p) => p.ticker.toUpperCase() === ticker.toUpperCase(),
  );
  // Default fallback: treat as TREND until we have more data
  return match?.behavior ?? "TREND";
}
