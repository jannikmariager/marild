/**
 * V4.7 Higher Timeframe (HTF) Alignment Module
 *
 * This module is ONLY used by the V4.7 backtest engine. It provides:
 * - A simple bias model based on a moving average of HTF closes
 * - A trade alignment helper (long/short vs HTF bias)
 * - Default per-profile HTF configs (daytrader/swing/investor)
 * - Feature flags so HTF alignment can be disabled for debugging
 */

import type { OHLCBar } from "../../signal_types.ts";
import type { SupportedTimeframe } from "../../ohlc_loader.ts";

export type HtfBias = "bullish" | "bearish" | "neutral";

export interface HtfAlignmentConfig {
  /** How many HTF bars to consider when computing bias (max window). */
  lookbackBars: number;
  /** Minimum number of HTF bars required before we trust any bias. */
  minBarsForBias: number;
  /** Moving average length (in HTF bars) used for trend/bias. */
  maLength: number;
  /** Upper threshold as a fraction, e.g. 0.002 = +0.2%. */
  priceAboveMaThreshold: number;
  /** Lower threshold as a fraction, e.g. 0.002 = -0.2%. */
  priceBelowMaThreshold: number;
}

export interface HtfProfileConfig extends HtfAlignmentConfig {
  timeframe: SupportedTimeframe;
}

export interface HtfConfigPerProfile {
  daytrader: HtfProfileConfig;
  swing: HtfProfileConfig;
  investor: HtfProfileConfig;
}

/**
 * Default HTF configuration for V4.7.
 *
 * These are intentionally conservative; they can be tuned later.
 */
export const DEFAULT_V47_HTF_CONFIG: HtfConfigPerProfile = {
  daytrader: {
    timeframe: "15m",
    lookbackBars: 100,
    minBarsForBias: 50,
    maLength: 50,
    priceAboveMaThreshold: 0.002, // +0.2%
    priceBelowMaThreshold: 0.002, // -0.2%
  },
  swing: {
    timeframe: "1d",
    lookbackBars: 200,
    minBarsForBias: 100,
    maLength: 50,
    priceAboveMaThreshold: 0.003, // +0.3%
    priceBelowMaThreshold: 0.003, // -0.3%
  },
  investor: {
    timeframe: "1w",
    lookbackBars: 100,
    minBarsForBias: 50,
    maLength: 20,
    priceAboveMaThreshold: 0.005, // +0.5%
    priceBelowMaThreshold: 0.005, // -0.5%
  },
};

export const V47_FEATURE_FLAGS = {
  /** Global switch to enable/disable HTF alignment in the V4.7 engine. */
  enableHtfAlignment: true,
} as const;

/**
 * Compute HTF bias from a series of HTF bars and config.
 *
 * Logic:
 * - If we have fewer than minBarsForBias, return neutral.
 * - Take up to lookbackBars of most recent HTF bars.
 * - Compute a simple moving average of close over maLength.
 * - Compare latest close to MA with upper/lower thresholds.
 */
export function computeHtfBias(
  htfBars: OHLCBar[],
  config: HtfAlignmentConfig,
): HtfBias {
  const n = htfBars.length;
  if (!htfBars || n === 0) return "neutral";

  const effectiveCount = Math.min(config.lookbackBars, n);
  if (effectiveCount < config.minBarsForBias) return "neutral";

  const startIndex = n - effectiveCount;
  const closes: number[] = [];
  for (let i = startIndex; i < n; i++) {
    const c = Number(htfBars[i].close);
    if (!Number.isFinite(c)) continue;
    closes.push(c);
  }

  if (closes.length < config.minBarsForBias || closes.length === 0) {
    return "neutral";
  }

  const maLen = Math.min(config.maLength, closes.length);
  if (maLen <= 0) return "neutral";

  let sum = 0;
  for (let i = closes.length - maLen; i < closes.length; i++) {
    sum += closes[i];
  }
  const ma = sum / maLen;

  const latest = closes[closes.length - 1];
  if (!Number.isFinite(latest) || !Number.isFinite(ma) || ma <= 0) {
    return "neutral";
  }

  const upper = ma * (1 + config.priceAboveMaThreshold);
  const lower = ma * (1 - config.priceBelowMaThreshold);

  if (latest > upper) return "bullish";
  if (latest < lower) return "bearish";
  return "neutral";
}

/**
 * Decide whether a trade direction is allowed under a given HTF bias.
 */
export function isTradeAlignedWithHtf(
  direction: "long" | "short",
  bias: HtfBias,
): boolean {
  if (bias === "neutral") return true;
  if (bias === "bullish") return direction === "long";
  if (bias === "bearish") return direction === "short";
  return true;
}

/**
 * Find the most recent HTF bar whose timestamp is <= entryTs.
 *
 * Uses binary search over sorted HTF bars. Returns null when no
 * such bar exists.
 */
export function findHtfBarForEntry(
  entryTs: string,
  htfBars: OHLCBar[],
): OHLCBar | null {
  const idx = findHtfBarIndexForEntry(entryTs, htfBars);
  if (idx === -1) return null;
  return htfBars[idx];
}

/**
 * Internal index helper used by the execution model for efficient
 * mapping from entry timestamps to HTF indices.
 */
export function findHtfBarIndexForEntry(
  entryTs: string,
  htfBars: OHLCBar[],
): number {
  if (!htfBars.length) return -1;
  const target = Date.parse(entryTs);
  if (!Number.isFinite(target)) return -1;

  let lo = 0;
  let hi = htfBars.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ts = Date.parse(htfBars[mid].timestamp);
    if (!Number.isFinite(ts)) {
      // Skip malformed bars by moving bounds inward
      if (mid === lo) {
        lo++;
      } else {
        hi--;
      }
      continue;
    }

    if (ts <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}
