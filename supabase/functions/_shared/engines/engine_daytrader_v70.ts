// supabase/functions/_shared/engines/engine_daytrader_v70.ts
//
// V7.0 DAYTRADER intraday engine (5m).
//
// Implements four micro-strategies on 5m bars only:
//   1. Opening Range Breakout (OR-BO)
//   2. VWAP Trend Pullback
//   3. VWAP Reversal / Mean Reversion
//   4. Liquidity Sweep + Continuation
//
// Entry-point: runDaytraderV70(input: EngineInput): Promise<EngineResult>
// Used by tools/v70_daytrader_backtest.ts for offline research.

import type { OHLCBar, EngineType } from "../signal_types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EngineInput {
  symbol: string;
  style: EngineType; // expect "DAYTRADER"
  timeframe: string; // expect "5m"
  horizonDays?: number;
  bars5m: OHLCBar[];
}

export interface EngineResult {
  engineVersion: "V7.0";
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface DayV70Context {
  symbol: string;
  style: EngineType;
  timeframe: string;
  index: number; // current bar index (last)
  bar: OHLCBar; // current bar
  bars: OHLCBar[];

  // Session info
  sessionStartIndex: number;
  minutesSinceOpen: number;
  minutesToClose: number | null;
  inRth: boolean;

  // Volatility / trend
  atr: number;
  atrNorm: number; // ATR vs median ATR in lookback
  volRegime: "low" | "normal" | "high";

  // VWAP & moving averages
  vwap: number;
  ema9: number;
  ema21: number;
  ema9Slope: number;
  ema21Slope: number;
  trend1h: "up" | "down" | "flat";
  trend1d: "up" | "down" | "flat";

  // Structure
  orHigh: number | null;
  orLow: number | null;
  swingHigh: number | null;
  swingLow: number | null;

  // Volume
  relVolume: number; // vs session average

  // Compression
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

const MIN_CONF_V70 = 42;
const MIN_RR_V70 = 1.2;

// Treat US equities as RTH-bound, crypto as 24/7 (no RTH gating).
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
  return range > 0 && range < atr * 1.0; // narrow relative to ATR
}

function classifyVolRegime(atrNorm: number): "low" | "normal" | "high" {
  if (atrNorm < 0.7) return "low";
  if (atrNorm > 1.6) return "high";
  return "normal";
}

function computeMinutesSinceOpenAndToClose(symbol: string, bar: OHLCBar): { minutesSinceOpen: number; minutesToClose: number | null; inRth: boolean } {
  const isCrypto = isCryptoLike(symbol);
  if (isCrypto) {
    // For crypto-like symbols, treat the whole session as tradable, approximate session as long.
    return {
      minutesSinceOpen: 0,
      minutesToClose: null,
      inRth: true,
    };
  }

  // Approximate US equities RTH in UTC: 14:30 - 21:00
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

function buildV70Context(input: EngineInput): DayV70Context | null {
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

  // Approximate 1h and 1d trend labels via slower EMAs on 5m closes
  const emaFast1h = ema(closes.slice(-72), 18); // ~6h window
  const emaSlow1h = ema(closes.slice(-72), 36);
  const trend1h = trendLabelFromSlope(emaFast1h, emaSlow1h, closes[closes.length - 1] * 0.0005);

  const emaFast1d = ema(closes.slice(-288), 48); // ~20 hours of 5m bars
  const emaSlow1d = ema(closes.slice(-288), 96);
  const trend1d = trendLabelFromSlope(emaFast1d, emaSlow1d, closes[closes.length - 1] * 0.0007);

  // Opening range: first 30 minutes of session (6 x 5m bars)
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

// ---------------------------------------------------------------------------
// Strategy detectors
// ---------------------------------------------------------------------------

function detectOrBreakout(ctx: DayV70Context): Candidate | null {
  const { bar, orHigh, orLow, atr, atrNorm, volRegime, relVolume, minutesSinceOpen, minutesToClose } = ctx;
  if (orHigh == null || orLow == null || atr <= 0) return null;

  // Only trade after OR is formed and not into very late session (for equities).
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

function detectVwapTrendPullback(ctx: DayV70Context): Candidate | null {
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

function detectVwapReversal(ctx: DayV70Context): Candidate | null {
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
  if (range > atr * 1.5) confidence -= 3; // avoid huge exhaustion bars
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

function detectLiquiditySweep(ctx: DayV70Context): Candidate | null {
  const { bar, swingHigh, swingLow, vwap, atr, atrNorm, compression, relVolume } = ctx;
  if (atr <= 0) return null;
  if (swingHigh == null || swingLow == null) return null;

  const sweepBuffer = atr * 0.2;

  let direction: "LONG" | "SHORT" | null = null;
  // Sweep of prior low, reclaiming level and closing near/above VWAP
  if (
    bar.low < swingLow - sweepBuffer &&
    bar.close > swingLow &&
    Math.abs(bar.close - vwap) < atr * 0.8 &&
    bar.close > bar.open
  ) {
    direction = "LONG";
  }
  // Sweep of prior high, rejection and close below level/VWAP
  else if (
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
  if (compression) confidence += 5; // compression -> sweep -> expansion
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

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function runDaytraderV70(input: EngineInput): Promise<EngineResult> {
  const { style, timeframe, bars5m } = input;

  if (style !== "DAYTRADER" || timeframe.toLowerCase() !== "5m") {
    return {
      engineVersion: "V7.0",
      decision: "NO_TRADE",
      meta: {
        reason: "unsupported_style_or_timeframe",
        style,
        timeframe,
      },
    };
  }

  if (!bars5m || bars5m.length < 60) {
    return {
      engineVersion: "V7.0",
      decision: "NO_TRADE",
      meta: {
        reason: "insufficient_bars",
        bars: bars5m?.length ?? 0,
      },
    };
  }

  const ctx = buildV70Context(input);
  if (!ctx) {
    return {
      engineVersion: "V7.0",
      decision: "NO_TRADE",
      meta: { reason: "context_build_failed" },
    };
  }

  // RTH gating for equities (skip out-of-session and last 10m)
  if (!isCryptoLike(ctx.symbol)) {
    if (!ctx.inRth || (ctx.minutesToClose !== null && ctx.minutesToClose <= 10)) {
      return {
        engineVersion: "V7.0",
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

  const filtered = candidates.filter((c) => c.confidence >= MIN_CONF_V70 && c.rr >= MIN_RR_V70);
  if (!filtered.length) {
    return {
      engineVersion: "V7.0",
      decision: "NO_TRADE",
      meta: {
        reason: "no_candidate_passed_filters",
        rawCandidates: candidates.length,
      },
    };
  }

  filtered.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.rr - a.rr;
  });

  const best = filtered[0];

  return {
    engineVersion: "V7.0",
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
