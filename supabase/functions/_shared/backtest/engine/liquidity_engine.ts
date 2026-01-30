// supabase/functions/_shared/backtest/engine/liquidity_engine.ts
// Liquidity v2: sweeps, equal highs/lows scoring

import type { OHLCV, LiquidityResult } from './types.ts';

function nearlyEqual(a: number, b: number, pct = 0.001): boolean {
  const avg = (a + b) / 2;
  if (avg <= 0) return false;
  return Math.abs(a - b) / avg < pct;
}

export function runLiquidityEngine(primary: OHLCV[]): LiquidityResult {
  let eq_highs = false;
  let eq_lows = false;
  let sweep: LiquidityResult['sweep'] = null;

  for (let i = 1; i < primary.length; i++) {
    if (nearlyEqual(primary[i].high, primary[i - 1].high)) eq_highs = true;
    if (nearlyEqual(primary[i].low, primary[i - 1].low)) eq_lows = true;

    const brokeHigh = primary[i].high > primary[i - 1].high && primary[i].close < primary[i - 1].high;
    const brokeLow = primary[i].low < primary[i - 1].low && primary[i].close > primary[i - 1].low;
    if (brokeHigh) sweep = 'buy_side';
    if (brokeLow) sweep = 'sell_side';
  }

  let score = 0;
  if (eq_highs) score += 30;
  if (eq_lows) score += 30;
  if (sweep) score += 40;
  score = Math.max(0, Math.min(100, score));

  return { sweep, eq_highs, eq_lows, score };
}
