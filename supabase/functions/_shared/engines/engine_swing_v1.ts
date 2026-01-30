// supabase/functions/_shared/engines/engine_swing_v1.ts
//
// SwingEngine v1
//
// Simple 4h swing engine with daily trend filter and pullback entries.
// This is intentionally much simpler than the intraday daytrader engine
// so that backtest results are easy to interpret and trust.

import type { OHLCBar, EngineType } from "../signal_types.ts";

export interface SwingEngineInput {
  symbol: string;
  style: EngineType; // expect "SWING"
  timeframe: string; // expect "4h"
  bars4h: OHLCBar[];
}

export interface SwingEngineResult {
  engineVersion: "SWING_V1";
  decision: "TRADE" | "NO_TRADE";
  direction?: "LONG" | "SHORT";
  entry?: number;
  stop?: number;
  target?: number;
  confidence?: number; // 0-100
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
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

  // First ATR value at index = period using simple average of initial TRs
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

  // Wilder-style smoothing for subsequent bars
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
// Core logic
// ---------------------------------------------------------------------------

export async function runSwingV1(input: SwingEngineInput): Promise<SwingEngineResult> {
  const { symbol, style, timeframe, bars4h } = input;

  if (style !== "SWING" || timeframe !== "4h") {
    return {
      engineVersion: "SWING_V1",
      decision: "NO_TRADE",
      reason: "invalid_style_or_timeframe",
    };
  }

  const bars = bars4h;
  if (!bars || bars.length < 60) {
    return {
      engineVersion: "SWING_V1",
      decision: "NO_TRADE",
      reason: "insufficient_bars",
    };
  }

  const closes = bars.map((b) => b.close);

  // 4h EMAs for local trend/pullback zone
  const ema10 = emaSeries(closes, 10);
  const ema20 = emaSeries(closes, 20);

  // "Daily" trend approximation via long EMAs on 4h closes
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);

  const atr = atrSeries(bars, 14);

  const idx = bars.length - 1; // last completed bar
  const bar = bars[idx];
  const close = bar.close;

  const e10 = ema10[idx];
  const e20 = ema20[idx];
  const e50 = ema50[idx];
  const e200 = ema200[idx];
  const a14 = atr[idx] || 0;

  // Approximate daily regime from EMAs
  let regime: "bull" | "bear" | "sideways" = "sideways";
  if (close > e50 && e50 > e200) regime = "bull";
  else if (close < e50 && e50 < e200) regime = "bear";

  // Require some volatility
  if (!a14 || a14 <= 0) {
    return {
      engineVersion: "SWING_V1",
      decision: "NO_TRADE",
      reason: "atr_zero",
    };
  }

  const prev = bars[idx - 1];

  // Simple pullback zone between EMA10 and EMA20
  const upperBand = Math.max(e10, e20);
  const lowerBand = Math.min(e10, e20);

  // Long: price pulls back into EMA10-20 band in bull regime and closes bullish
  const inPullbackZoneLong = close <= upperBand && close >= lowerBand;

  // Short: price pulls back up into band in bear regime and closes bearish
  const inPullbackZoneShort = close >= lowerBand && close <= upperBand;

  // Candle direction only (keep v1 simple and generous)
  const bullishCandle = close > bar.open;
  const bearishCandle = close < bar.open;

  const longSetup = regime === "bull" && inPullbackZoneLong && bullishCandle;

  const shortSetup = regime === "bear" && inPullbackZoneShort && bearishCandle;

  if (!longSetup && !shortSetup) {
    return {
      engineVersion: "SWING_V1",
      decision: "NO_TRADE",
      reason: "no_setup",
    };
  }

  const direction: "LONG" | "SHORT" = longSetup ? "LONG" : "SHORT";

  // Fixed ATR-based stop-loss and take profit
  if (direction === "LONG") {
    const entry = bar.close;
    const stop = entry - 2.0 * a14; // Fixed 2× ATR stop
    const riskPerShare = entry - stop;
    if (riskPerShare <= 0) {
      return {
        engineVersion: "SWING_V1",
        decision: "NO_TRADE",
        reason: "invalid_risk_long",
      };
    }
    const target = entry + 2.5 * riskPerShare; // 2.5R target
    const confidence = regime === "bull" ? 70 : 55;
    return {
      engineVersion: "SWING_V1",
      decision: "TRADE",
      direction,
      entry,
      stop,
      target,
      confidence,
      reason: `swing_v1_long_${symbol}`,
    };
  }

  // SHORT
  const entry = bar.close;
  const stop = entry + 2.0 * a14; // Fixed 2× ATR stop
  const riskPerShare = stop - entry;
  if (riskPerShare <= 0) {
    return {
      engineVersion: "SWING_V1",
      decision: "NO_TRADE",
      reason: "invalid_risk_short",
    };
  }
  const target = entry - 2.5 * riskPerShare; // 2.5R target
  const confidence = regime === "bear" ? 70 : 55;

  return {
    engineVersion: "SWING_V1",
    decision: "TRADE",
    direction,
    entry,
    stop,
    target,
    confidence,
    reason: `swing_v1_short_${symbol}`,
  };
}
