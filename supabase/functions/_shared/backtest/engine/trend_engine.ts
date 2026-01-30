// supabase/functions/_shared/backtest/engine/trend_engine.ts
// Trend v2: HTF(1d,4h) + LTF(1h,15m) direction, strength, exhaustion

import type { OHLCV, TrendResult } from './types.ts';

function ema(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n === 0) return out;
  const k = 2 / (period + 1);
  const init = Math.min(period, n);
  let sum = 0;
  for (let i = 0; i < init; i++) sum += values[i];
  let prev = sum / init;
  out[init - 1] = prev;
  for (let i = init; i < n; i++) {
    const v = values[i];
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function slopeScore(emaSeries: number[]): number {
  // Compare last vs prev values; scale to 0..100 based on relative slope
  const n = emaSeries.length;
  if (n < 3) return 50;
  const last = emaSeries[n - 1];
  const prev = emaSeries[n - 2];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || last === 0) return 50;
  const slope = (last - prev) / Math.abs(last);
  // map slope magnitude to 0..100 via tanh-like scaling
  const mag = Math.min(1, Math.max(0, Math.abs(slope) * 100));
  return Math.round(mag * 100) / 2; // coarse scaling
}

function directionFromEMAs(close: number[], fast: number, slow: number): 'up'|'down'|'sideways' {
  const fastE = ema(close, fast);
  const slowE = ema(close, slow);
  const n = close.length;
  const f = fastE[n - 1], s = slowE[n - 1];
  if (!Number.isFinite(f) || !Number.isFinite(s)) return 'sideways';
  if (f > s) return 'up';
  if (f < s) return 'down';
  return 'sideways';
}

function detectExhaustion(close: number[], vol?: number[]): boolean {
  // Simple exhaustion: 3-bar momentum slowdown (lower highs for uptrend or higher lows for downtrend)
  const n = close.length;
  if (n < 4) return false;
  const a = close[n - 1], b = close[n - 2], c = close[n - 3], d = close[n - 4];
  const upSlow = a < b && b < c && c > d; // rolling over
  const dnSlow = a > b && b > c && c < d; // rolling up from downtrend
  return upSlow || dnSlow;
}

export function runTrendEngine(args: { tf_1d: OHLCV[]; tf_4h: OHLCV[]; tf_1h: OHLCV[]; tf_15m: OHLCV[] }): TrendResult {
  const { tf_1d, tf_4h, tf_1h, tf_15m } = args;

  const c1d = tf_1d.map(b => Number(b.close));
  const c4h = tf_4h.map(b => Number(b.close));
  const c1h = tf_1h.map(b => Number(b.close));
  const c15 = tf_15m.map(b => Number(b.close));

  const dirHTF = directionFromEMAs(c1d, 20, 50) === 'up' || directionFromEMAs(c4h, 34, 89) === 'up' ? 'up'
    : directionFromEMAs(c1d, 20, 50) === 'down' || directionFromEMAs(c4h, 34, 89) === 'down' ? 'down'
    : 'sideways';

  const dirLTF = directionFromEMAs(c1h, 13, 34) === 'up' || directionFromEMAs(c15, 8, 21) === 'up' ? 'up'
    : directionFromEMAs(c1h, 13, 34) === 'down' || directionFromEMAs(c15, 8, 21) === 'down' ? 'down'
    : 'sideways';

  // Strength: average of slope scores across EMAs
  const strength = Math.round(
    (
      slopeScore(ema(c1d, 50)) +
      slopeScore(ema(c4h, 89)) +
      slopeScore(ema(c1h, 34)) +
      slopeScore(ema(c15, 21))
    ) / 4
  );

  // Final direction preference: HTF over LTF; if conflict -> sideways
  const direction: 'up'|'down'|'sideways' = dirHTF === dirLTF ? dirHTF : (dirHTF !== 'sideways' ? dirHTF : dirLTF);
  const exhaustion = detectExhaustion(c1h);

  return { direction, strength: Math.max(0, Math.min(100, strength)), exhaustion };
}
