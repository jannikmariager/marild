export function getBacktestEngineVersion(): "v4" | "v3" {
  const v = process.env.NEXT_PUBLIC_BACKTEST_ENGINE;
  // Default to v4 unless explicitly forced to v3
  return v === "v3" ? "v3" : "v4";
}
