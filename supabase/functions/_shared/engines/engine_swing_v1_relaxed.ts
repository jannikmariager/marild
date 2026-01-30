// supabase/functions/_shared/engines/engine_swing_v1_relaxed.ts
//
// SWING_V1_12_15DEC - Relaxed Variant
//
// Micro-relaxations for shadow engine only:
// • Allow sideways regime (EMA tolerance band)
// • Expand pullback zone (EMA8-25 instead of EMA10-20)
// • Allow wick-touch + candle top/bottom 40% instead of strict close
//
// DO NOT USE FOR BASELINE OR V2 ENGINES
// This is scoped exclusively to SWING_V1_12_15DEC (shadow mode only)

import type { OHLCBar, EngineType } from "../signal_types.ts";

export interface SwingEngineInput {
  symbol: string;
  style: EngineType;
  timeframe: string;
  bars4h: OHLCBar[];
}

export interface SwingEngineResult {
  engineVersion: "SWING_V1_RELAXED";
  decision: "TRADE" | "NO_TRADE";
  direction?: "LONG" | "SHORT";
  entry?: number;
  stop?: number;
  target?: number;
  confidence?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers (identical to v1)
// ---------------------------------------------------------------------------

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const p = Math.min(period, values.length);
  const k = 2 / (p + 1);
  const out: number[] = [];
  let ema = values.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = 0; i < values.length; i++) {
    if (i >= p) {
      ema = values[i] * k + ema * (1 - k);
    }
    out.push(ema);
  }
  return out;
}

function atrSeries(bars: OHLCBar[], period: number): number[] {
  const n = bars.length;
  const atrValues = new Array<number>(n).fill(0);
  if (n <= period) return atrValues;

  let sumTR = 0;
  for (let i = 1; i <= period; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    sumTR += tr;
  }
  let atr = sumTR / period;
  atrValues[period] = atr;

  for (let i = period + 1; i < n; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    atr = ((atr * (period - 1)) + tr) / period;
    atrValues[i] = atr;
  }

  return atrValues;
}

// ---------------------------------------------------------------------------
// Relaxed Core Logic
// ---------------------------------------------------------------------------

export async function runSwingV1Relaxed(input: SwingEngineInput): Promise<SwingEngineResult> {
  const { symbol, style, timeframe, bars4h } = input;

  if (style !== "SWING" || timeframe !== "4h") {
    return {
      engineVersion: "SWING_V1_RELAXED",
      decision: "NO_TRADE",
      reason: "invalid_style_or_timeframe",
    };
  }

  const bars = bars4h;
  if (!bars || bars.length < 60) {
    return {
      engineVersion: "SWING_V1_RELAXED",
      decision: "NO_TRADE",
      reason: "insufficient_bars",
    };
  }

  const closes = bars.map((b) => b.close);

  // EMAs
  const ema8 = emaSeries(closes, 8);    // Relaxed: shorter for quicker reaction
  const ema10 = emaSeries(closes, 10);
  const ema20 = emaSeries(closes, 20);
  const ema25 = emaSeries(closes, 25);  // Relaxed: wider pullback zone
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);

  const atr = atrSeries(bars, 14);

  const idx = bars.length - 1;
  const bar = bars[idx];
  const close = bar.close;

  const e8 = ema8[idx];
  const e10 = ema10[idx];
  const e20 = ema20[idx];
  const e25 = ema25[idx];
  const e50 = ema50[idx];
  const e200 = ema200[idx];
  const a14 = atr[idx] || 0;

  // RELAXATION #1: Allow sideways regime with tolerance band
  // Instead of strict trend filters, allow near-flat EMAs
  let regime: "bull" | "bear" | "sideways" = "sideways";
  const tolerance = 0.02; // 2% tolerance band
  
  if (close > e50 && e50 > e200) {
    regime = "bull";
  } else if (close < e50 && e50 < e200) {
    regime = "bear";
  } else if (
    Math.abs(e50 - e200) / e200 < tolerance &&
    Math.abs(close - e50) / e50 < tolerance * 2
  ) {
    // Allow "flat" regime for entries
    regime = "sideways";
  }

  if (!a14 || a14 <= 0) {
    return {
      engineVersion: "SWING_V1_RELAXED",
      decision: "NO_TRADE",
      reason: "atr_zero",
    };
  }

  // RELAXATION #2: Expanded pullback zone (EMA8-25 instead of EMA10-20)
  const upperBand = Math.max(e8, e25);
  const lowerBand = Math.min(e8, e25);
  
  // RELAXATION #3: Allow wick-touch OR close in top/bottom 40% of range
  const range = bar.high - bar.low;
  const mid = bar.low + range * 0.5;
  const topZone = bar.low + range * 0.4;  // Bottom 40%
  const bottomZone = bar.high - range * 0.4; // Top 40%
  
  // Wick touches zone boundary
  const wickTouchesUpper = bar.high >= upperBand && bar.low <= upperBand;
  const wickTouchesLower = bar.low <= lowerBand && bar.high >= lowerBand;
  
  // Close in top/bottom 40% of candle
  const closureInTopZone = close >= topZone;      // Close in top 40%
  const closureInBottomZone = close <= bottomZone; // Close in bottom 40%

  // Long: Pull back into zone + bullish indication (wick touch OR close in top)
  const inPullbackZoneLong = close <= upperBand && close >= lowerBand;
  const bullishIndicator = wickTouchesLower || closureInTopZone;
  
  // Short: Pull back into zone + bearish indication (wick touch OR close in bottom)
  const inPullbackZoneShort = close >= lowerBand && close <= upperBand;
  const bearishIndicator = wickTouchesUpper || closureInBottomZone;

  const longSetup = (regime === "bull" || regime === "sideways") && inPullbackZoneLong && bullishIndicator;
  const shortSetup = (regime === "bear" || regime === "sideways") && inPullbackZoneShort && bearishIndicator;

  if (!longSetup && !shortSetup) {
    return {
      engineVersion: "SWING_V1_RELAXED",
      decision: "NO_TRADE",
      reason: "no_setup",
    };
  }

  const direction: "LONG" | "SHORT" = longSetup ? "LONG" : "SHORT";

  // Risk management unchanged
  if (direction === "LONG") {
    const entry = bar.close;
    const stop = entry - 2.0 * a14;
    const riskPerShare = entry - stop;
    if (riskPerShare <= 0) {
      return {
        engineVersion: "SWING_V1_RELAXED",
        decision: "NO_TRADE",
        reason: "invalid_risk_long",
      };
    }
    const target = entry + 2.5 * riskPerShare;
    const confidence = regime === "bull" ? 70 : regime === "bear" ? 45 : 60;
    return {
      engineVersion: "SWING_V1_RELAXED",
      decision: "TRADE",
      direction,
      entry,
      stop,
      target,
      confidence,
      reason: `swing_v1_relaxed_long_${symbol}`,
    };
  }

  // SHORT
  const entry = bar.close;
  const stop = entry + 2.0 * a14;
  const riskPerShare = stop - entry;
  if (riskPerShare <= 0) {
    return {
      engineVersion: "SWING_V1_RELAXED",
      decision: "NO_TRADE",
      reason: "invalid_risk_short",
    };
  }
  const target = entry - 2.5 * riskPerShare;
  const confidence = regime === "bear" ? 70 : regime === "bull" ? 45 : 60;
  return {
    engineVersion: "SWING_V1_RELAXED",
    decision: "TRADE",
    direction,
    entry,
    stop,
    target,
    confidence,
    reason: `swing_v1_relaxed_short_${symbol}`,
  };
}
