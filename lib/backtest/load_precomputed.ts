import { BACKTEST_VERSION } from "./version";

export type PrecomputedStyle = "day" | "swing" | "invest";

export async function loadPrecomputedBacktest(
  symbol: string,
  style: PrecomputedStyle,
): Promise<any | null> {
  const cleanSymbol = symbol.toUpperCase();
  const path = `/backtests/${BACKTEST_VERSION}/${style}/${cleanSymbol}.json`;
  const res = await fetch(path, { cache: "no-store" });

  if (!res.ok) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
}
