// supabase/functions/_shared/engines/engine_daytrader_v71.ts
//
// V7.1 DAYTRADER intraday engine (5m).
//
// This engine reuses the V7.0 context + micro-strategy detectors but adds
// an extra precision layer wired through the V7.1 filters/scorecard
// (engine/daytrader/v71_*.ts) via engine/router.ts.
//
// The goal is to keep the same high-level trade patterns but enforce
// tighter micro-structure, momentum, volatility, and volume gates.

import type { OHLCBar, EngineType } from "../signal_types.ts";
import { evaluateEntry, scoreEntry } from "../../../../engine/router.ts";

// Reuse V7.0 types for input and candidates
export interface EngineInput {
  symbol: string;
  style: EngineType; // expect "DAYTRADER"
  timeframe: string; // expect "5m"
  horizonDays?: number;
  bars5m: OHLCBar[];
}

export interface EngineResult {
  engineVersion: "V7.1";
  decision: "TRADE" | "NO_TRADE";
  direction?: "LONG" | "SHORT";
  entry?: number;
  stop?: number;
  target?: number;
  confidence?: number; // 0-100
  rr?: number; // target RR
  pattern?: "OR_BREAKOUT" | "VWAP_TREND" | "VWAP_REVERSAL" | "SWEEP_CONTINUATION";
  reason?: string;
  meta?: Record<string, unknown>;
}

interface DayV71Context {
  symbol: string;
  style: EngineType;
  timeframe: string;
  index: number;
  bar: OHLCBar;
  bars: OHLCBar[];
  sessionStartIndex: number;
  minutesSinceOpen: number;
  minutesToClose: number | null;
  inRth: boolean;
  atr: number;
  atrNorm: number;
  volRegime: "low" | "normal" | "high";
  vwap: number;
  ema9: number;
  ema21: number;
  ema9Slope: number;
  ema21Slope: number;
  trend1h: "up" | "down" | "flat";
  trend1d: "up" | "down" | "flat";
  orHigh: number | null;
  orLow: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  relVolume: number;
  compression: boolean;
}

interface Candidate {
  pattern: EngineResult["pattern"];
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
  reason: string;
}

const MIN_CONF_V70 = 42; // base V7.0 gate (still used as coarse filter)
const MIN_RR_V70 = 1.2;

function isCryptoLike(symbol: string): boolean {
  return symbol.toUpperCase().endsWith("USD");
}

function toDate(d: string): Date {
  return new Date(d);
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function getSessionStartIndex(bars: OHLCBar[]): number {
  if (!bars.length) return 0;
  const last = toDate(bars[bars.length - 1].timestamp);
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = toDate(bars[i].timestamp);
    if (!sameYMD(d, last)) return i + 1;
  }
  return 0;
}

function computeAtrAtIndex(bars: OHLCBar[], idx: number, period: number): number {
  if (idx <= 0 || bars.length < period + 1) return 0;
  const start = Math.max(1, idx - period + 1);
  const trs: number[] = [];
  for (let i = start; i <= idx; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  if (!trs.length) return 0;
  return trs.reduce((s, v) => s + v, 0) / trs.length;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? (a[mid - 1] + a[mid]) / 2 : a[mid];
}

function computeAtrNorm(bars: OHLCBar[], idx: number, period = 14, window = 80): { atr: number; atrNorm: number } {
  const atr = computeAtrAtIndex(bars, idx, period);
  const start = Math.max(1, idx - window);
  const atrs: number[] = [];
  for (let i = start; i <= idx; i++) {
    const v = computeAtrAtIndex(bars, i, period);
    if (v > 0) atrs.push(v);
  }
  const med = median(atrs);
  return { atr, atrNorm: med > 0 ? atr / med : 1 };
}

function computeVWAP(bars: OHLCBar[], startIdx: number, endIdx: number): number {
  let pv = 0;
  let vol = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const b = bars[i];
    const price = (b.high + b.low + b.close) / 3;
    pv += price * b.volume;
    vol += b.volume;
  }
  if (vol <= 0) return bars[endIdx].close;
  return pv / vol;
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const p = Math.min(period, values.length);
  const k = 2 / (p + 1);
  let emaVal = values.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = p; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function computeEmaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const out: number[] = [];
  const p = Math.min(period, values.length);
  const k = 2 / (p + 1);
  let emaVal = values.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = 0; i < values.length; i++) {
    if (i < p) {
      out.push(emaVal);
      continue;
    }
    emaVal = values[i] * k + emaVal * (1 - k);
    out.push(emaVal);
  }
  return out;
}

function trendLabelFromSlope(fast: number, slow: number, threshold: number): "up" | "down" | "flat" {
  const diff = fast - slow;
  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "flat";
}

function computeSwingHighLow(bars: OHLCBar[], endIdx: number, lookback = 30): { swingHigh: number | null; swingLow: number | null } {
  const start = Math.max(0, endIdx - lookback);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i < endIdx; i++) {
    const b = bars[i];
    if (b.high > hi) hi = b.high;
    if (b.low < lo) lo = b.low;
  }
  return {
    swingHigh: hi === -Infinity ? null : hi,
    swingLow: lo === Infinity ? null : lo,
  };
}

function computeRelVolume(bars: OHLCBar[], sessionStart: number, endIdx: number): number {
  const b = bars[endIdx];
  const current = b.volume;
  let sum = 0;
  let count = 0;
  for (let i = sessionStart; i <= endIdx; i++) {
    sum += bars[i].volume;
    count++;
  }
  const avg = count > 0 ? sum / count : 0;
  if (avg <= 0) return 1;
  return current / avg;
}

function computeCompression(bars: OHLCBar[], idx: number, atr: number, lookbackBars = 8): boolean {
  if (atr <= 0) return false;
  const start = Math.max(0, idx - lookbackBars + 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i <= idx; i++) {
    hi = Math.max(hi, bars[i].high);
    lo = Math.min(lo, bars[i].low);
  }
  const range = hi - lo;
  return range > 0 && range < atr * 1.0;
}

function classifyVolRegime(atrNorm: number): "low" | "normal" | "high" {
  if (atrNorm < 0.7) return "low";
  if (atrNorm > 1.6) return "high";
  return "normal";
}

function computeMinutesSinceOpenAndToClose(symbol: string, bar: OHLCBar): { minutesSinceOpen: number; minutesToClose: number | null; inRth: boolean } {
  const isCrypto = isCryptoLike(symbol);
  if (isCrypto) {
    return {
      minutesSinceOpen: 0,
      minutesToClose: null,
      inRth: true,
    };
  }

  const d = toDate(bar.timestamp);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const open = 14 * 60 + 30;
  const close = 21 * 60;

  if (mins < open || mins > close) {
    return { minutesSinceOpen: 0, minutesToClose: null, inRth: false };
  }

  return {
    minutesSinceOpen: mins - open,
    minutesToClose: close - mins,
    inRth: true,
  };
}

function buildV71Context(input: EngineInput): DayV71Context | null {
  const { symbol, style, timeframe, bars5m } = input;
  if (!bars5m.length) return null;
  const bars = bars5m;
  const index = bars.length - 1;
  const bar = bars[index];

  const sessionStartIndex = getSessionStartIndex(bars);
  const { minutesSinceOpen, minutesToClose, inRth } = computeMinutesSinceOpenAndToClose(symbol, bar);

  const { atr, atrNorm } = computeAtrNorm(bars, index, 14, 80);
  const volRegime = classifyVolRegime(atrNorm || 1);

  const vwap = computeVWAP(bars, sessionStartIndex, index);

  const closes = bars.map((b) => b.close);
  const ema9Series = computeEmaSeries(closes, 9);
  const ema21Series = computeEmaSeries(closes, 21);
  const ema9 = ema9Series[index];
  const ema21 = ema21Series[index];
  const ema9Prev = ema9Series[Math.max(0, index - 3)];
  const ema21Prev = ema21Series[Math.max(0, index - 3)];
  const ema9Slope = ema9 - ema9Prev;
  const ema21Slope = ema21 - ema21Prev;

  const emaFast1h = ema(closes.slice(-72), 18);
  const emaSlow1h = ema(closes.slice(-72), 36);
  const trend1h = trendLabelFromSlope(emaFast1h, emaSlow1h, closes[closes.length - 1] * 0.0005);

  const emaFast1d = ema(closes.slice(-288), 48);
  const emaSlow1d = ema(closes.slice(-288), 96);
  const trend1d = trendLabelFromSlope(emaFast1d, emaSlow1d, closes[closes.length - 1] * 0.0007);

  let orHigh: number | null = null;
  let orLow: number | null = null;
  const orEnd = Math.min(sessionStartIndex + 6, bars.length);
  if (orEnd - sessionStartIndex >= 3) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = sessionStartIndex; i < orEnd; i++) {
      hi = Math.max(hi, bars[i].high);
      lo = Math.min(lo, bars[i].low);
    }
    orHigh = hi === -Infinity ? null : hi;
    orLow = lo === Infinity ? null : lo;
  }

  const { swingHigh, swingLow } = computeSwingHighLow(bars, index, 40);
  const relVolume = computeRelVolume(bars, sessionStartIndex, index);
  const compression = computeCompression(bars, index, atr || 0, 8);

  return {
    symbol,
    style,
    timeframe,
    index,
    bar,
    bars,
    sessionStartIndex,
    minutesSinceOpen,
    minutesToClose,
    inRth,
    atr,
    atrNorm: atrNorm || 1,
    volRegime,
    vwap,
    ema9,
    ema21,
    ema9Slope,
    ema21Slope,
    trend1h,
    trend1d,
    orHigh,
    orLow,
    swingHigh,
    swingLow,
    relVolume,
    compression,
  };
}

// --- V7.0 detectors reused as-is (copied) --------------------------

function detectOrBreakout(ctx: DayV71Context): Candidate | null {
  const { bar, orHigh, orLow, atr, atrNorm, volRegime, relVolume, minutesSinceOpen, minutesToClose } = ctx;
  if (orHigh == null || orLow == null || atr <= 0) return null;

  if (!isCryptoLike(ctx.symbol)) {
    if (minutesSinceOpen < 30) return null;
    if (minutesToClose !== null && minutesToClose <= 15) return null;
  }

  if (atrNorm < 0.7 || atrNorm > 2.5) return null;
  if (relVolume < 1.1) return null;

  const buffer = atr * 0.2;
  const close = bar.close;

  let direction: "LONG" | "SHORT" | null = null;
  if (close > orHigh + buffer && bar.low > orHigh * 0.999) {
    direction = "LONG";
  } else if (close < orLow - buffer && bar.high < orLow * 1.001) {
    direction = "SHORT";
  }
  if (!direction) return null;

  const entry = close;
  const stop = direction === "LONG" ? orHigh - atr * 0.4 : orLow + atr * 0.4;
  if (direction === "LONG" && stop >= entry) return null;
  if (direction === "SHORT" && stop <= entry) return null;

  const risk = Math.abs(entry - stop);
  const rr = 1.8;
  const target = direction === "LONG" ? entry + risk * rr : entry - risk * rr;

  let confidence = 55;
  if (ctx.trend1h === (direction === "LONG" ? "up" : "down")) confidence += 5;
  if (ctx.trend1d === (direction === "LONG" ? "up" : "down")) confidence += 5;
  if (volRegime === "normal") confidence += 3;
  if (volRegime === "high") confidence -= 5;
  if (relVolume > 1.5) confidence += 3;
  confidence = Math.max(0, Math.min(95, confidence));

  return {
    pattern: "OR_BREAKOUT",
    direction,
    entry,
    stop,
    target,
    rr,
    confidence,
    reason: `OR breakout ${direction} with relVol=${relVolume.toFixed(2)}, atrNorm=${atrNorm.toFixed(2)}`,
  };
}

function detectVwapTrendPullback(ctx: DayV71Context): Candidate | null {
  const { bar, vwap, ema9, ema21, ema9Slope, ema21Slope, atr, atrNorm, volRegime, relVolume } = ctx;
  if (atr <= 0) return null;

  const bullishTrend = ema9 > ema21 && ema9Slope > 0 && ema21Slope >= 0;
  const bearishTrend = ema9 < ema21 && ema9Slope < 0 && ema21Slope <= 0;
  if (!bullishTrend && !bearishTrend) return null;

  const distFromVwap = bar.close - vwap;
  const pullbackThreshold = atr * 0.5;

  let direction: "LONG" | "SHORT" | null = null;
  if (bullishTrend && bar.low <= vwap && distFromVwap > -pullbackThreshold) {
    direction = "LONG";
  } else if (bearishTrend && bar.high >= vwap && distFromVwap < pullbackThreshold) {
    direction = "SHORT";
  }
  if (!direction) return null;

  const entry = bar.close;
  const stop = direction === "LONG" ? Math.min(bar.low, vwap - atr * 0.4) : Math.max(bar.high, vwap + atr * 0.4);
  if (direction === "LONG" && stop >= entry) return null;
  if (direction === "SHORT" && stop <= entry) return null;

  const risk = Math.abs(entry - stop);
  const rr = 1.7;
  const target = direction === "LONG" ? entry + risk * rr : entry - risk * rr;

  let confidence = 50;
  if (ctx.trend1h === (direction === "LONG" ? "up" : "down")) confidence += 6;
  if (ctx.trend1d === (direction === "LONG" ? "up" : "down")) confidence += 4;
  if (volRegime === "normal") confidence += 3;
  if (volRegime === "high") confidence -= 3;
  if (atrNorm > 2.0) confidence -= 4;
  if (relVolume > 1.3) confidence += 3;
  confidence = Math.max(0, Math.min(92, confidence));

  return {
    pattern: "VWAP_TREND",
    direction,
    entry,
    stop,
    target,
    rr,
    confidence,
    reason: `VWAP trend pullback ${direction} with ema9/21 trend and relVol=${relVolume.toFixed(2)}`,
  };
}

function detectVwapReversal(ctx: DayV71Context): Candidate | null {
  const { bar, vwap, atr, atrNorm, volRegime, relVolume } = ctx;
  if (atr <= 0) return null;

  const overshootThreshold = atr * 0.9;
  const belowVWAP = vwap - bar.low;
  const aboveVWAP = bar.high - vwap;

  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;

  let direction: "LONG" | "SHORT" | null = null;
  if (belowVWAP > overshootThreshold && lowerWick > body && bar.close > bar.open) {
    direction = "LONG";
  } else if (aboveVWAP > overshootThreshold && upperWick > body && bar.close < bar.open) {
    direction = "SHORT";
  }
  if (!direction) return null;

  const entry = bar.close;
  const stop = direction === "LONG" ? bar.low - atr * 0.2 : bar.high + atr * 0.2;
  if (direction === "LONG" && stop >= entry) return null;
  if (direction === "SHORT" && stop <= entry) return null;

  const risk = Math.abs(entry - stop);
  const rr = 1.5;
  const target = direction === "LONG" ? entry + risk * rr : entry - risk * rr;

  let confidence = 48;
  if (volRegime === "normal") confidence += 3;
  if (volRegime === "high") confidence -= 4;
  if (atrNorm > 2.2) confidence -= 4;
  if (relVolume > 1.4) confidence += 4;
  if (range > atr * 1.5) confidence -= 3;
  confidence = Math.max(0, Math.min(90, confidence));

  return {
    pattern: "VWAP_REVERSAL",
    direction,
    entry,
    stop,
    target,
    rr,
    confidence,
    reason: `VWAP mean reversion ${direction} after overshoot with wick exhaustion`,
  };
}

function detectLiquiditySweep(ctx: DayV71Context): Candidate | null {
  const { bar, swingHigh, swingLow, vwap, atr, atrNorm, compression, relVolume } = ctx;
  if (atr <= 0) return null;
  if (swingHigh == null || swingLow == null) return null;

  const sweepBuffer = atr * 0.2;

  let direction: "LONG" | "SHORT" | null = null;
  if (
    bar.low < swingLow - sweepBuffer &&
    bar.close > swingLow &&
    Math.abs(bar.close - vwap) < atr * 0.8 &&
    bar.close > bar.open
  ) {
    direction = "LONG";
  } else if (
    bar.high > swingHigh + sweepBuffer &&
    bar.close < swingHigh &&
    Math.abs(bar.close - vwap) < atr * 0.8 &&
    bar.close < bar.open
  ) {
    direction = "SHORT";
  }

  if (!direction) return null;

  const entry = bar.close;
  const stop = direction === "LONG" ? Math.min(bar.low, swingLow) - atr * 0.15 : Math.max(bar.high, swingHigh) + atr * 0.15;
  if (direction === "LONG" && stop >= entry) return null;
  if (direction === "SHORT" && stop <= entry) return null;

  const risk = Math.abs(entry - stop);
  const rr = 2.0;
  const target = direction === "LONG" ? entry + risk * rr : entry - risk * rr;

  let confidence = 52;
  if (compression) confidence += 5;
  if (atrNorm > 1.0 && atrNorm < 2.2) confidence += 4;
  if (atrNorm >= 2.2) confidence -= 4;
  if (relVolume > 1.5) confidence += 4;
  confidence = Math.max(0, Math.min(96, confidence));

  return {
    pattern: "SWEEP_CONTINUATION",
    direction,
    entry,
    stop,
    target,
    rr,
    confidence,
    reason: `Liquidity sweep ${direction} with VWAP confluence and compression=${compression}`,
  };
}

// --- Bar -> V7.1 signal adapter ---------------------------------

function buildV71Signal(ctx: DayV71Context, c: Candidate): any {
  const { bar, vwap, atr, atrNorm, relVolume, compression, ema9Slope, ema21Slope, trend1h, trend1d } = ctx;
  const range = Math.max(1e-6, bar.high - bar.low);
  const body = Math.abs(bar.close - bar.open);
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;

  const price = bar.close || ((bar.high + bar.low) / 2) || 1;
  const slopeMag = Math.abs(ema9Slope) / price;
  const momentumScore = Math.max(0, Math.min(100, slopeMag * 40_000));

  const expansionRaw = Math.max(0, atrNorm - 1);
  const expansionScaled = Math.max(0, Math.min(1, expansionRaw / 1.5));

  const compressionVal = compression ? 0.2 : 0.6;

  const dirAligned =
    (c.direction === "LONG" && (trend1h === "up" || trend1d === "up" || ema21Slope > 0)) ||
    (c.direction === "SHORT" && (trend1h === "down" || trend1d === "down" || ema21Slope < 0));

  const directionLabel = dirAligned ? "aligned" : "contra";

  const fromSwing = c.direction === "LONG" && ctx.swingLow != null
    ? (bar.close - ctx.swingLow) / Math.max(atr || 1e-6, 1e-6)
    : c.direction === "SHORT" && ctx.swingHigh != null
    ? (ctx.swingHigh - bar.close) / Math.max(atr || 1e-6, 1e-6)
    : 0;

  const disp = Math.max(0, Math.min(1, Math.max(Math.abs(bar.close - vwap) / Math.max(atr || 1e-6, 1e-6), fromSwing)));

  const wickSize = c.direction === "LONG" ? lowerWick : upperWick;
  const wickRatio = range > 0 ? wickSize / range : 0;
  const rejection = wickRatio >= 0.25 && body < range * 0.6;

  const volRel = Math.max(0, Math.min(1.5, relVolume)) / 1.5;

  return {
    momentum: {
      score: momentumScore,
      expansion: expansionScaled,
    },
    structure: {
      microBOS: true,
      displacement: disp,
    },
    wick: {
      rejection,
      sizeRatio: wickRatio,
    },
    volatility: {
      compression: compressionVal,
      expansion: expansionScaled,
    },
    volume: {
      relative: volRel,
    },
    trend: {
      direction: directionLabel,
    },
    confidence: c.confidence,
  };
}

// --- Main entrypoint ---------------------------------------------

export async function runDaytraderV71(input: EngineInput): Promise<EngineResult> {
  const { style, timeframe, bars5m } = input;

  if (style !== "DAYTRADER" || timeframe.toLowerCase() !== "5m") {
    return {
      engineVersion: "V7.1",
      decision: "NO_TRADE",
      meta: { reason: "unsupported_style_or_timeframe", style, timeframe },
    };
  }

  if (!bars5m || bars5m.length < 60) {
    return {
      engineVersion: "V7.1",
      decision: "NO_TRADE",
      meta: { reason: "insufficient_bars", bars: bars5m?.length ?? 0 },
    };
  }

  const ctx = buildV71Context(input);
  if (!ctx) {
    return {
      engineVersion: "V7.1",
      decision: "NO_TRADE",
      meta: { reason: "context_build_failed" },
    };
  }

  if (!isCryptoLike(ctx.symbol)) {
    if (!ctx.inRth || (ctx.minutesToClose !== null && ctx.minutesToClose <= 10)) {
      return {
        engineVersion: "V7.1",
        decision: "NO_TRADE",
        meta: {
          reason: "outside_rth_or_too_close_to_close",
          inRth: ctx.inRth,
          minutesToClose: ctx.minutesToClose,
        },
      };
    }
  }

  const candidates: Candidate[] = [];
  const c1 = detectOrBreakout(ctx);
  if (c1) candidates.push(c1);
  const c2 = detectVwapTrendPullback(ctx);
  if (c2) candidates.push(c2);
  const c3 = detectVwapReversal(ctx);
  if (c3) candidates.push(c3);
  const c4 = detectLiquiditySweep(ctx);
  if (c4) candidates.push(c4);

  const coarse = candidates.filter((c) => c.confidence >= MIN_CONF_V70 && c.rr >= MIN_RR_V70);
  if (!coarse.length) {
    return {
      engineVersion: "V7.1",
      decision: "NO_TRADE",
      meta: { reason: "no_candidate_passed_coarse_filters", rawCandidates: candidates.length },
    };
  }

  const precisionPassed: Array<{ cand: Candidate; signal: any; score: number }> = [];
  for (const cand of coarse) {
    const signal = buildV71Signal(ctx, cand);
    const passes = evaluateEntry("7.1", signal, ctx.symbol);
    if (!passes) continue;
    const score = scoreEntry("7.1", signal);
    precisionPassed.push({ cand, signal, score });
  }

  if (!precisionPassed.length) {
    return {
      engineVersion: "V7.1",
      decision: "NO_TRADE",
      meta: {
        reason: "no_candidate_passed_v71_precision_filters",
        rawCandidates: candidates.length,
        coarseCandidates: coarse.length,
      },
    };
  }

  precisionPassed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.cand.confidence ?? 0) !== (a.cand.confidence ?? 0)) return (b.cand.confidence ?? 0) - (a.cand.confidence ?? 0);
    return b.cand.rr - a.cand.rr;
  });

  const best = precisionPassed[0].cand;

  return {
    engineVersion: "V7.1",
    decision: "TRADE",
    direction: best.direction,
    entry: best.entry,
    stop: best.stop,
    target: best.target,
    confidence: best.confidence,
    rr: best.rr,
    pattern: best.pattern,
    reason: best.reason,
    meta: {
      vwap: ctx.vwap,
      atr: ctx.atr,
      atrNorm: ctx.atrNorm,
      volRegime: ctx.volRegime,
      trend1h: ctx.trend1h,
      trend1d: ctx.trend1d,
      relVolume: ctx.relVolume,
      compression: ctx.compression,
      minutesSinceOpen: ctx.minutesSinceOpen,
      minutesToClose: ctx.minutesToClose,
      sessionStartIndex: ctx.sessionStartIndex,
      barIndex: ctx.index,
    },
  };
}
