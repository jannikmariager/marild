// supabase/functions/_shared/backtest/engine/volatility_engine.ts
// Volatility v2: ATR(14) classification and stability score

import type { OHLCV, VolatilityResult } from './types.ts';

function atr(bars: OHLCV[], period = 14): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;
  const trs = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const h = Number(bars[i].high), l = Number(bars[i].low), pc = Number(bars[i - 1].close);
    trs[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0, cnt = 0;
  for (let i = 1; i < n && cnt < period; i++, cnt++) sum += trs[i];
  if (cnt < period) return out;
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = ((prev * (period - 1)) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function runVolatilityEngine(primary: OHLCV[]): VolatilityResult {
  if (!primary || primary.length < 20) {
    return { atr_value: 0, state: 'normal', score: 50 };
  }
  const atrVals = atr(primary, 14);
  const lastAtr = atrVals[atrVals.length - 1] || 0;
  const price = primary[primary.length - 1].close || 1;
  const ratio = lastAtr / price;
  let state: VolatilityResult['state'] = 'normal';
  if (ratio < 0.001) state = 'low';
  else if (ratio > 0.02) state = 'high';

  // Stability score: inverse of volatility extremes
  let score = 70;
  if (state === 'low') score = 40; // chop risk
  if (state === 'high') score = 50; // danger zones

  return { atr_value: lastAtr, state, score };
}
