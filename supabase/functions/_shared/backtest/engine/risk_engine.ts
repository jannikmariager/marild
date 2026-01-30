// supabase/functions/_shared/backtest/engine/risk_engine.ts
// Risk v2: OB-based SL/TP with RR enforcement and ATR fallbacks

import type { OHLCV, SMCResult, VolatilityResult, RiskLevels } from './types.ts';

const ATR_PERIOD = 14;
const ATR_MULT_TRAILING = 1.5; // for reference by exits engine

function atr(bars: OHLCV[], period = ATR_PERIOD): number[] {
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

function nearestOBPrice(smc: SMCResult, direction: 'long'|'short', refPrice: number): { slRef: number|null; tpRef: number|null } {
  const obs = smc.order_blocks.filter(z => z.direction === (direction === 'long' ? 'bullish' : 'bearish'));
  const opp = smc.order_blocks.filter(z => z.direction !== (direction === 'long' ? 'bullish' : 'bearish'));
  let slRef: number|null = null;
  let tpRef: number|null = null;
  // SL reference based on nearest same-direction OB boundary
  if (direction === 'long') {
    let bestDist = Infinity;
    for (const z of obs) {
      const dist = Math.abs(refPrice - z.bottom);
      if (z.bottom < refPrice && dist < bestDist) { bestDist = dist; slRef = z.bottom; }
    }
  } else {
    let bestDist = Infinity;
    for (const z of obs) {
      const dist = Math.abs(refPrice - z.top);
      if (z.top > refPrice && dist < bestDist) { bestDist = dist; slRef = z.top; }
    }
  }
  // TP reference at opposing OB boundary (nearest)
  if (direction === 'long') {
    let bestDist = Infinity;
    for (const z of opp) {
      const dist = Math.abs(z.top - refPrice);
      if (z.top > refPrice && dist < bestDist) { bestDist = dist; tpRef = z.top; }
    }
  } else {
    let bestDist = Infinity;
    for (const z of opp) {
      const dist = Math.abs(refPrice - z.bottom);
      if (z.bottom < refPrice && dist < bestDist) { bestDist = dist; tpRef = z.bottom; }
    }
  }
  return { slRef, tpRef };
}

export function generateRiskLevels(args: {
  direction: 'long'|'short';
  entryPrice: number;
  primary: OHLCV[];
  smc: SMCResult;
  vol: VolatilityResult;
}): RiskLevels | null {
  const { direction, entryPrice, primary, smc } = args;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;

  const atrVals = atr(primary, ATR_PERIOD);
  const lastAtr = atrVals[atrVals.length - 1] || 0;

  // OB-based references
  const { slRef, tpRef } = nearestOBPrice(smc, direction, entryPrice);

  // SL rule per spec
  let sl = slRef ?? (direction === 'long' ? entryPrice - 1.5 * lastAtr : entryPrice + 1.5 * lastAtr);
  // TP rule per spec
  let tp = tpRef ?? (direction === 'long' ? entryPrice + 3 * lastAtr : entryPrice - 3 * lastAtr);

  // Ensure logical ordering
  if (direction === 'long') {
    if (!(sl < entryPrice && tp > entryPrice)) return null;
    const rr = (tp - entryPrice) / (entryPrice - sl);
    if (rr < 1.5) {
      // Try to push TP to next structural bound: choose farthest opposing OB if available
      const oppOB = smc.order_blocks.filter(z => z.direction === 'bearish');
      const candidates = oppOB.map(z => z.top).filter(p => p > entryPrice);
      const maxOpp = candidates.length ? Math.max(...candidates) : tp;
      const tp2 = Math.max(tp, maxOpp);
      const rr2 = (tp2 - entryPrice) / (entryPrice - sl);
      if (rr2 < 1.5) return null;
      tp = tp2;
    }
    return { sl_price: sl, tp_price: tp, rr_ratio: (tp - entryPrice) / (entryPrice - sl) };
  } else {
    if (!(sl > entryPrice && tp < entryPrice)) return null;
    const rr = (entryPrice - tp) / (sl - entryPrice);
    if (rr < 1.5) {
      const oppOB = smc.order_blocks.filter(z => z.direction === 'bullish');
      const candidates = oppOB.map(z => z.bottom).filter(p => p < entryPrice);
      const minOpp = candidates.length ? Math.min(...candidates) : tp;
      const tp2 = Math.min(tp, minOpp);
      const rr2 = (entryPrice - tp2) / (sl - entryPrice);
      if (rr2 < 1.5) return null;
      tp = tp2;
    }
    return { sl_price: sl, tp_price: tp, rr_ratio: (entryPrice - tp) / (sl - entryPrice) };
  }
}
