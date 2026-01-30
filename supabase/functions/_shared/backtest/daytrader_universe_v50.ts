// supabase/functions/_shared/backtest/daytrader_universe_v50.ts
//
// Daytrader universe configuration for v5.0 engine.
// Defines a simple WHITELIST/BLACKLIST plus safety limits for backtests.

export type DaytraderStatus = "ENABLED" | "DISABLED";
export type DaytraderFlag = "WHITELIST" | "BLACKLIST";

export interface DaytraderTickerConfig {
  ticker: string;
  status: DaytraderStatus;
  flag: DaytraderFlag;
  notes?: string;
}

// Seeded from v5.0 DAYTRADER backtest results (365d, 5m subset).
// This is a starting point and should be extended as more data comes in.
export const DAYTRADER_TICKERS_V50: DaytraderTickerConfig[] = [
  // WHITELIST – good/acceptable daytrader names from v5.0
  { ticker: "NVDA", status: "ENABLED", flag: "WHITELIST", notes: "trend tech, positive avgR" },
  { ticker: "META", status: "ENABLED", flag: "WHITELIST", notes: "trend tech, positive avgR" },
  { ticker: "MARA", status: "ENABLED", flag: "WHITELIST", notes: "volatile, positive avgR" },
  { ticker: "DUST", status: "ENABLED", flag: "WHITELIST", notes: "massive avgR but wild" },
  { ticker: "HUT",  status: "ENABLED", flag: "WHITELIST", notes: "slightly positive, can review" },
  // TODO: add more known “OK” names once broader backtests confirm them

  // BLACKLIST – ugly daytrader names from v5.0
  { ticker: "MDB",  status: "DISABLED", flag: "BLACKLIST", notes: "large negative avgR" },
  { ticker: "UBER", status: "DISABLED", flag: "BLACKLIST", notes: "large negative avgR" },
  { ticker: "NKE",  status: "DISABLED", flag: "BLACKLIST", notes: "large negative avgR" },
  { ticker: "CLOV", status: "DISABLED", flag: "BLACKLIST", notes: "0% win, negative avgR" },
  { ticker: "BBBY", status: "DISABLED", flag: "BLACKLIST", notes: "877 trades, negative avgR" },
  // Extend with more toxic names from reports (COIN, ERX, SI, TZA, etc.) as needed.
];

export function getDaytraderConfig(ticker: string): DaytraderTickerConfig | null {
  const t = ticker.toUpperCase();
  const match = DAYTRADER_TICKERS_V50.find((c) => c.ticker === t);
  return match || null;
}

// Safety limits for v5.0 DAYTRADER backtests.
export interface DaytraderLimits {
  maxTradesPerBacktest: number;
}

export const DAYTRADER_LIMITS_V50: DaytraderLimits = {
  // Hard cap to avoid BBBY-style 800+ trade explosions in a single backtest.
  maxTradesPerBacktest: 200,
};
