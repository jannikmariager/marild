import type { OHLCBar } from "../../signal_types.ts";
import type { BOSSignal } from "./bos_detector_v47.ts";

export interface OrderBlock {
  direction: "bullish" | "bearish";
  index: number;
  high: number;
  low: number;
  mitigated: boolean;
}

function findLastBearishCandle(bars: OHLCBar[], startIndex: number): number {
  for (let i = startIndex; i >= 0; i--) {
    if (bars[i].close < bars[i].open) return i;
  }
  return -1;
}

function findLastBullishCandle(bars: OHLCBar[], startIndex: number): number {
  for (let i = startIndex; i >= 0; i--) {
    if (bars[i].close > bars[i].open) return i;
  }
  return -1;
}

export function detectOrderBlocks(bosList: BOSSignal[], bars: OHLCBar[]): OrderBlock[] {
  const result: OrderBlock[] = [];
  const seen = new Set<number>();

  for (const bos of bosList) {
    if (bos.direction === "bullish") {
      const idx = findLastBearishCandle(bars, bos.index - 1);
      if (idx >= 0 && !seen.has(idx)) {
        seen.add(idx);
        const bar = bars[idx];
        result.push({
          direction: "bullish",
          index: idx,
          high: bar.high,
          low: bar.low,
          mitigated: false,
        });
      }
    } else {
      const idx = findLastBullishCandle(bars, bos.index - 1);
      if (idx >= 0 && !seen.has(idx)) {
        seen.add(idx);
        const bar = bars[idx];
        result.push({
          direction: "bearish",
          index: idx,
          high: bar.high,
          low: bar.low,
          mitigated: false,
        });
      }
    }
  }

  return result;
}

/**
 * Mark order blocks as mitigated when price closes through 50% of the zone.
 */
export function markMitigation(obList: OrderBlock[], bars: OHLCBar[]): void {
  for (const ob of obList) {
    if (ob.mitigated) continue;
    const mid = (ob.high + ob.low) / 2;

    for (let i = ob.index + 1; i < bars.length; i++) {
      const close = bars[i].close;

      if (ob.direction === "bullish") {
        // Bullish OB mitigated when price closes below mid-level
        if (close <= mid) {
          ob.mitigated = true;
          break;
        }
      } else {
        // Bearish OB mitigated when price closes above mid-level
        if (close >= mid) {
          ob.mitigated = true;
          break;
        }
      }
    }
  }
}
