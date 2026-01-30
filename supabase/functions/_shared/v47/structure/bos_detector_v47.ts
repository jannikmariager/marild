import type { OHLCBar } from "../../signal_types.ts";
import type { StructureStateV47 } from "../engine/structure_state_v47.ts";

export interface BOSSignal {
  index: number;
  price: number;
  direction: "bullish" | "bearish";
  swingIndex: number;
}

const SWING_LOOKBACK = 3; // bars on each side

function isSwingHigh(bars: OHLCBar[], i: number): boolean {
  const hi = bars[i].high;
  for (let k = 1; k <= SWING_LOOKBACK; k++) {
    if (i - k < 0 || i + k >= bars.length) return false;
    if (bars[i - k].high >= hi || bars[i + k].high >= hi) return false;
  }
  return true;
}

function isSwingLow(bars: OHLCBar[], i: number): boolean {
  const lo = bars[i].low;
  for (let k = 1; k <= SWING_LOOKBACK; k++) {
    if (i - k < 0 || i + k >= bars.length) return false;
    if (bars[i - k].low <= lo || bars[i + k].low <= lo) return false;
  }
  return true;
}

/**
 * Detect BOS events and update structure state.
 */
export function detectBOS(
  bars: OHLCBar[],
  state: StructureStateV47,
): BOSSignal[] {
  const bosSignals: BOSSignal[] = [];
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  if (bars.length < SWING_LOOKBACK * 2 + 1) return bosSignals;

  // Build swings
  for (let i = SWING_LOOKBACK; i < bars.length - SWING_LOOKBACK; i++) {
    if (isSwingHigh(bars, i)) swingHighs.push(i);
    if (isSwingLow(bars, i)) swingLows.push(i);
  }

  let lastSwingHighIdx = swingHighs.length > 0 ? swingHighs[0] : -1;
  let lastSwingLowIdx = swingLows.length > 0 ? swingLows[0] : -1;

  // Iterate bars chronologically and detect BOS relative to latest swings
  for (let i = 0; i < bars.length; i++) {
    if (swingHighs.includes(i)) lastSwingHighIdx = i;
    if (swingLows.includes(i)) lastSwingLowIdx = i;

    const close = bars[i].close;

    // Bullish BOS: close > previous swing high close
    if (lastSwingHighIdx >= 0 && i > lastSwingHighIdx) {
      const refClose = bars[lastSwingHighIdx].close;
      if (close > refClose) {
        const bos: BOSSignal = {
          index: i,
          price: close,
          direction: "bullish",
          swingIndex: lastSwingHighIdx,
        };
        bosSignals.push(bos);
        state.bosHistory.push(bos);
        state.ltfBias = "bullish";
      }
    }

    // Bearish BOS: close < previous swing low close
    if (lastSwingLowIdx >= 0 && i > lastSwingLowIdx) {
      const refClose = bars[lastSwingLowIdx].close;
      if (close < refClose) {
        const bos: BOSSignal = {
          index: i,
          price: close,
          direction: "bearish",
          swingIndex: lastSwingLowIdx,
        };
        bosSignals.push(bos);
        state.bosHistory.push(bos);
        state.ltfBias = "bearish";
      }
    }
  }

  return bosSignals;
}
