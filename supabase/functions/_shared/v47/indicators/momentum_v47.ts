import type { OHLCBar } from "../../signal_types.ts";

export interface MomentumStateV47 {
  index: number;
  wprFast: number;
  wprSlow: number;
  wad: number;
  longOK: boolean;
  shortOK: boolean;
}

const WPR_FAST_LOOKBACK = 10;
const WPR_SLOW_LOOKBACK = 21;
const WAD_SLOPE_WINDOW = 5;

function computeWilliamsR(bars: OHLCBar[], lookback: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (lookback <= 1 || bars.length < lookback) return out;

  for (let i = lookback - 1; i < bars.length; i++) {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - lookback + 1; j <= i; j++) {
      if (bars[j].high > highestHigh) highestHigh = bars[j].high;
      if (bars[j].low < lowestLow) lowestLow = bars[j].low;
    }
    const c = bars[i].close;
    const range = highestHigh - lowestLow;
    if (!Number.isFinite(range) || range <= 0) {
      out[i] = NaN;
      continue;
    }
    out[i] = -100 * (highestHigh - c) / range;
  }

  return out;
}

function computeWAD(bars: OHLCBar[]): number[] {
  const wad = new Array<number>(bars.length).fill(0);
  if (bars.length === 0) return wad;

  wad[0] = 0;
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const c = bars[i].close;
    const h = bars[i].high;
    const l = bars[i].low;

    let delta = 0;
    if (c > prevClose) {
      delta = c - Math.min(l, prevClose);
    } else if (c < prevClose) {
      delta = c - Math.max(h, prevClose);
    } else {
      delta = 0;
    }
    wad[i] = wad[i - 1] + delta;
  }

  return wad;
}

function wadSlope(wad: number[], index: number, window: number): number {
  const start = index - window + 1;
  if (start < 0) return 0;
  const first = wad[start];
  const last = wad[index];
  return last - first;
}

export function computeMomentumStates(bars: OHLCBar[]): MomentumStateV47[] {
  const n = bars.length;
  if (n === 0) return [];

  const wprFast = computeWilliamsR(bars, WPR_FAST_LOOKBACK);
  const wprSlow = computeWilliamsR(bars, WPR_SLOW_LOOKBACK);
  const wad = computeWAD(bars);

  const states: MomentumStateV47[] = [];

  for (let i = 1; i < n; i++) {
    const fastPrev = wprFast[i - 1];
    const slowPrev = wprSlow[i - 1];
    const fastNow = wprFast[i];
    const slowNow = wprSlow[i];

    const slope = wadSlope(wad, i, WAD_SLOPE_WINDOW);

    let longOK = false;
    let shortOK = false;

    // Long conditions:
    // - %R_fast crosses ABOVE %R_slow
    // - Prior values both below -80 (deep oversold)
    // - WAD trending upward (slope > 0)
    if (
      Number.isFinite(fastPrev) && Number.isFinite(slowPrev) &&
      Number.isFinite(fastNow) && Number.isFinite(slowNow)
    ) {
      const crossUp = fastPrev <= slowPrev && fastNow > slowNow;
      const deepOversoldPrev = fastPrev < -80 && slowPrev < -80;
      if (crossUp && deepOversoldPrev && slope > 0) {
        longOK = true;
      }

      // Short conditions:
      // - %R_fast crosses BELOW %R_slow
      // - Prior values both above -20 (overbought)
      // - WAD trending downward (slope < 0)
      const crossDown = fastPrev >= slowPrev && fastNow < slowNow;
      const overboughtPrev = fastPrev > -20 && slowPrev > -20;
      if (crossDown && overboughtPrev && slope < 0) {
        shortOK = true;
      }
    }

    states.push({
      index: i,
      wprFast: wprFast[i],
      wprSlow: wprSlow[i],
      wad: wad[i],
      longOK,
      shortOK,
    });
  }

  return states;
}
