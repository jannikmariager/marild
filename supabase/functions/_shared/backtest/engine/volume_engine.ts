// supabase/functions/_shared/backtest/engine/volume_engine.ts
// Volume v2: expansion, divergence, climax, imbalance detection

import type { OHLCV, VolumeResult } from './types.ts';

function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function runVolumeEngine(primary: OHLCV[], ref?: { htf?: OHLCV[] }): VolumeResult {
  if (!primary || primary.length === 0) {
    return { expansion: false, divergence: false, climax: false, score: 0 };
  }
  const vols = primary.map(b => Number(b.volume ?? 0));
  const closes = primary.map(b => Number(b.close));
  const n = primary.length;
  const avg20 = sma(vols, Math.min(20, n)) || 0;
  const curV = vols[n - 1] || 0;
  const prevC = closes[n - 2] ?? closes[n - 1];
  const curC = closes[n - 1];

  const expansion = avg20 > 0 ? (curV / avg20) > 1.5 : false;
  const priceUp = curC > prevC;
  const volUp = curV > (vols[n - 2] ?? curV);
  const divergence = (priceUp && !volUp) || (!priceUp && volUp);
  const climax = avg20 > 0 ? (curV / avg20) > 3.0 : false;

  // Score: expansion + inverse penalty for divergence, bonus for climax (but capped)
  let score = 0;
  if (expansion) score += 60;
  if (climax) score += 25;
  if (divergence) score -= 20;
  score = Math.max(0, Math.min(100, score));

  return { expansion, divergence, climax, score };
}
