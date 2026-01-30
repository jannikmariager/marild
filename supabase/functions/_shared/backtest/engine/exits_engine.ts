// supabase/functions/_shared/backtest/engine/exits_engine.ts
// Exits v2: trailing SL, break-even, opposite CHoCH, volume collapse, OB mitigation

import type { OHLCV, SMCResult, ExitSignal } from './types.ts';

const ATR_TRAILING_MULT = 1.5;
const BE_BUFFER_ATR_MULT = 0.1; // 0.1 ATR buffer beyond entry
const VOLUME_COLLAPSE_THRESHOLD = 0.30; // <30% of 20-bar avg

function atr14Last(bars: OHLCV[]): number {
  if (bars.length < 15) return 0;
  let sum = 0;
  for (let i = bars.length - 14; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    sum += tr;
  }
  return sum / 14;
}

function avg20Vol(bars: OHLCV[]): number {
  if (bars.length < 20) return bars.reduce((a, b) => a + (b.volume || 0), 0) / bars.length || 1;
  let sum = 0;
  for (let i = bars.length - 20; i < bars.length; i++) sum += (bars[i].volume ?? 0);
  return sum / 20;
}

export function evaluateExits(args: {
  direction: 'long'|'short';
  entryPrice: number;
  currentSL: number;
  currentTP: number;
  bars: OHLCV[];
  smc: SMCResult;
  entryOB?: { top: number; bottom: number };
}): ExitSignal {
  const { direction, entryPrice, currentSL, currentTP, bars, smc, entryOB } = args;
  const n = bars.length;
  if (n < 2) return { should_exit: false, reason: null };
  const curBar = bars[n - 1];
  const atrVal = atr14Last(bars);
  const avgVol = avg20Vol(bars);
  const curVol = curBar.volume ?? 0;
  const price = curBar.close;

  // 1) Break-even: if profit >= 1R move SL to entry + 0.1 ATR
  const slDist = Math.abs(entryPrice - currentSL);
  const unrealized = direction === 'long' ? price - entryPrice : entryPrice - price;
  let newSL = currentSL;
  let beReason = false;
  if (unrealized >= slDist) {
    const bePrice = direction === 'long' ? entryPrice + atrVal * BE_BUFFER_ATR_MULT : entryPrice - atrVal * BE_BUFFER_ATR_MULT;
    if (direction === 'long' && bePrice > newSL) { newSL = bePrice; beReason = true; }
    if (direction === 'short' && bePrice < newSL) { newSL = bePrice; beReason = true; }
  }

  // 2) Trailing SL
  let trailingSL = direction === 'long'
    ? price - ATR_TRAILING_MULT * atrVal
    : price + ATR_TRAILING_MULT * atrVal;
  // only ratchet in favor of trade
  if (direction === 'long' && trailingSL > newSL) newSL = trailingSL;
  if (direction === 'short' && trailingSL < newSL) newSL = trailingSL;

  // 3) Opposite CHoCH
  const recentChoch = smc.choch.slice(-2);
  for (const c of recentChoch) {
    if (direction === 'long' && c.direction === 'down') return { should_exit: true, reason: 'opposite_choch', new_sl: newSL };
    if (direction === 'short' && c.direction === 'up') return { should_exit: true, reason: 'opposite_choch', new_sl: newSL };
  }

  // 4) Volume collapse
  if (avgVol > 0 && curVol / avgVol < VOLUME_COLLAPSE_THRESHOLD) {
    return { should_exit: true, reason: 'volume_collapse', new_sl: newSL };
  }

  // 5) OB mitigation (price returns to entry OB and rejects)
  if (entryOB) {
    const inZone = curBar.low <= entryOB.top && curBar.high >= entryOB.bottom;
    const rejection = direction === 'long'
      ? curBar.close < curBar.open // bearish close
      : curBar.close > curBar.open; // bullish close
    if (inZone && rejection) return { should_exit: true, reason: 'ob_mitigated', new_sl: newSL };
  }

  // No immediate exit but SL may have been updated
  return { should_exit: false, reason: beReason ? 'break_even' : 'trailing_sl', new_sl: newSL };
}
