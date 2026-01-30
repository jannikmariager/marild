// supabase/functions/_shared/backtest/engine/smc_engine.ts
// v4.8 SMC engine implementing ICT rules (OB, BOS/CHoCH, FVG, Liquidity)

import type { OHLCV, SMCResult, OrderBlockZone, FVGZone, LiquidityEvent } from './types.ts';

// Utility: swing detection
function isSwingHigh(bars: OHLCV[], i: number): boolean {
  if (i <= 0 || i >= bars.length - 1) return false;
  return bars[i].high > bars[i - 1].high && bars[i].high > bars[i + 1].high;
}

function isSwingLow(bars: OHLCV[], i: number): boolean {
  if (i <= 0 || i >= bars.length - 1) return false;
  return bars[i].low < bars[i - 1].low && bars[i].low < bars[i + 1].low;
}

// Equal highs/lows tolerance 0.1%
function nearlyEqual(a: number, b: number, pct = 0.001): boolean {
  const avg = (a + b) / 2;
  if (avg <= 0) return false;
  return Math.abs(a - b) / avg < pct;
}

// ATR(14) minimal util for FVG threshold
function atr14(bars: OHLCV[]): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length < 2) return out;
  const tr: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const h = Number(bars[i].high), l = Number(bars[i].low), pc = Number(bars[i - 1].close);
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0;
  let count = 0;
  for (let i = 1; i < bars.length && count < 14; i++, count++) sum += tr[i];
  if (count < 14) return out;
  let prev = sum / 14;
  out[14] = prev;
  for (let i = 15; i < bars.length; i++) {
    prev = ((prev * 13) + tr[i]) / 14;
    out[i] = prev;
  }
  return out;
}

// Detect BOS using body close beyond previous swing
function detectBOS(bars: OHLCV[]): Array<{ time: string; price: number; direction: 'up'|'down' }> {
  const res: Array<{ time: string; price: number; direction: 'up'|'down' }> = [];
  const swingHighIdx: number[] = [];
  const swingLowIdx: number[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    if (isSwingHigh(bars, i)) swingHighIdx.push(i);
    if (isSwingLow(bars, i)) swingLowIdx.push(i);
  }
  // bullish BOS: close > previous swing high
  for (let i = 1; i < bars.length; i++) {
    const close = bars[i].close;
    const prevHighIdx = swingHighIdx.filter(idx => idx < i).pop();
    if (prevHighIdx !== undefined) {
      if (close > bars[prevHighIdx].high) {
        res.push({ time: bars[i].timestamp, price: bars[prevHighIdx].high, direction: 'up' });
      }
    }
    const prevLowIdx = swingLowIdx.filter(idx => idx < i).pop();
    if (prevLowIdx !== undefined) {
      if (close < bars[prevLowIdx].low) {
        res.push({ time: bars[i].timestamp, price: bars[prevLowIdx].low, direction: 'down' });
      }
    }
  }
  return res;
}

function detectCHoCH(bos: Array<{ time: string; price: number; direction: 'up'|'down' }>): Array<{ time: string; price: number; direction: 'up'|'down' }> {
  const res: Array<{ time: string; price: number; direction: 'up'|'down' }> = [];
  for (let i = 1; i < bos.length; i++) {
    const prev = bos[i - 1];
    const cur = bos[i];
    if (prev.direction !== cur.direction) {
      // opposite-direction BOS after prior BOS = CHoCH
      res.push({ time: cur.time, price: cur.price, direction: cur.direction });
    }
  }
  return res;
}

// ICT OB: last opposite candle before displacement breaking structure
function detectOrderBlocks(bars: OHLCV[], bos: Array<{ time: string; price: number; direction: 'up'|'down' }>): OrderBlockZone[] {
  const zones: OrderBlockZone[] = [];
  // map BOS time -> index
  const indexByTime = new Map<string, number>();
  for (let i = 0; i < bars.length; i++) indexByTime.set(bars[i].timestamp, i);

  for (const b of bos) {
    const i = indexByTime.get(b.time);
    if (i === undefined) continue;
    // search backwards for the last opposite candle before displacement
    let j = i - 1;
    while (j > 0) {
      const cur = bars[j];
      const prev = bars[j - 1];
      if (b.direction === 'up') {
        // displacement candle must close above previous swing high (already satisfied for BOS)
        // last bearish candle before that is OB
        if (cur.close > prev.close && cur.open < cur.close) {
          // keep going
          j--;
          continue;
        }
        if (cur.close < cur.open) {
          zones.push({
            direction: 'bullish',
            top: cur.open,
            bottom: cur.low,
            open_time: cur.timestamp,
            close_time: cur.timestamp,
            mitigated: false,
            origin: 'bos',
          });
          break;
        }
      } else {
        // bearish BOS: find last bullish candle prior
        if (cur.close < prev.close && cur.open > cur.close) {
          j--;
          continue;
        }
        if (cur.close > cur.open) {
          zones.push({
            direction: 'bearish',
            top: cur.high,
            bottom: cur.open,
            open_time: cur.timestamp,
            close_time: cur.timestamp,
            mitigated: false,
            origin: 'bos',
          });
          break;
        }
      }
      j--;
    }
  }
  return zones;
}

// Mitigation: price returns into OB zone and rejects (wick + opposite color close)
function markMitigations(bars: OHLCV[], zones: OrderBlockZone[]): void {
  for (const z of zones) {
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const inZone = bar.low <= z.top && bar.high >= z.bottom;
      if (!inZone) continue;
      // rejection: wick into zone and opposite color close
      const bearishClose = bar.close < bar.open;
      const bullishClose = bar.close > bar.open;
      if (z.direction === 'bullish' && bearishClose) {
        z.mitigated = true;
        z.mitigation_time = bar.timestamp;
        break;
      }
      if (z.direction === 'bearish' && bullishClose) {
        z.mitigated = true;
        z.mitigation_time = bar.timestamp;
        break;
      }
    }
  }
}

// FVG detection with min size (0.05% or 0.2 ATR)
function detectFVG(bars: OHLCV[]): FVGZone[] {
  const res: FVGZone[] = [];
  const atr = atr14(bars);
  for (let i = 2; i < bars.length; i++) {
    const low_i = bars[i].low;
    const high_i2 = bars[i - 2].high;
    const high_i = bars[i].high;
    const low_i2 = bars[i - 2].low;
    // gaps
    if (low_i > high_i2) {
      const gap = low_i - high_i2;
      const minPct = (bars[i].close > 0 ? bars[i].close : 1) * 0.0005; // 0.05%
      const minAtr = (Number.isFinite(atr[i]) ? atr[i] * 0.2 : 0);
      if (gap >= Math.max(minPct, minAtr)) {
        res.push({ direction: 'bullish', start_index: i - 2, end_index: i, gap_top: low_i, gap_bottom: high_i2, size: gap });
      }
    }
    if (high_i < low_i2) {
      const gap = low_i2 - high_i; // absolute gap
      const minPct = (bars[i].close > 0 ? bars[i].close : 1) * 0.0005;
      const minAtr = (Number.isFinite(atr[i]) ? atr[i] * 0.2 : 0);
      if (gap >= Math.max(minPct, minAtr)) {
        res.push({ direction: 'bearish', start_index: i - 2, end_index: i, gap_top: low_i2, gap_bottom: high_i, size: gap });
      }
    }
  }
  return res;
}

function detectLiquidity(bars: OHLCV[]): LiquidityEvent[] {
  const events: LiquidityEvent[] = [];
  // equal highs / lows
  for (let i = 1; i < bars.length; i++) {
    if (nearlyEqual(bars[i].high, bars[i - 1].high, 0.001)) {
      events.push({ type: 'eq_highs', price: Math.max(bars[i].high, bars[i - 1].high), time: bars[i].timestamp });
    }
    if (nearlyEqual(bars[i].low, bars[i - 1].low, 0.001)) {
      events.push({ type: 'eq_lows', price: Math.min(bars[i].low, bars[i - 1].low), time: bars[i].timestamp });
    }
    // simple sweep detection: current high breaks prior equal highs then closes back inside
    const brokeHigh = bars[i].high > bars[i - 1].high && bars[i].close < bars[i - 1].high;
    const brokeLow = bars[i].low < bars[i - 1].low && bars[i].close > bars[i - 1].low;
    if (brokeHigh) events.push({ type: 'sweep_buy_side', price: bars[i].high, time: bars[i].timestamp });
    if (brokeLow) events.push({ type: 'sweep_sell_side', price: bars[i].low, time: bars[i].timestamp });
  }
  return events;
}

function premiumDiscount(bars: OHLCV[]): 'premium'|'discount'|'neutral' {
  if (bars.length < 2) return 'neutral';
  const lows = bars.map(b => b.low);
  const highs = bars.map(b => b.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const mid = (min + max) / 2;
  const lastClose = bars[bars.length - 1].close;
  if (lastClose > mid) return 'premium';
  if (lastClose < mid) return 'discount';
  return 'neutral';
}

function computeSMCStrength(args: {
  bos: Array<{ direction: 'up'|'down' }>,
  choch: Array<{ direction: 'up'|'down' }>,
  ob: OrderBlockZone[],
  fvg: FVGZone[],
  liq: LiquidityEvent[],
  zone: 'premium'|'discount'|'neutral',
}): number {
  // Simple deterministic scoring: presence and alignment with recent structure
  let score = 0;
  const recentBos = args.bos.slice(-3);
  const recentChoch = args.choch.slice(-2);
  if (recentBos.some(b => b.direction === 'up')) score += 15;
  if (recentBos.some(b => b.direction === 'down')) score += 15;
  if (recentChoch.length > 0) score += 10;
  if (args.ob.length > 0) score += 20;
  if (args.fvg.length > 0) score += 15;
  if (args.liq.some(e => e.type === 'sweep_buy_side' || e.type === 'sweep_sell_side')) score += 10;
  if (args.zone !== 'neutral') score += 5;
  return Math.max(0, Math.min(100, score));
}

export function runSMCEngine(primaryBars: OHLCV[]): SMCResult {
  const bos = detectBOS(primaryBars);
  const choch = detectCHoCH(bos);
  const ob = detectOrderBlocks(primaryBars, bos);
  markMitigations(primaryBars, ob);
  const fvg = detectFVG(primaryBars);
  const liq = detectLiquidity(primaryBars);
  const zone = premiumDiscount(primaryBars);
  const smc_strength = computeSMCStrength({ bos, choch, ob, fvg, liq, zone });
  return {
    bos,
    choch,
    order_blocks: ob,
    fvg,
    liquidity_events: liq,
    premium_discount_zone: zone,
    smc_strength,
  };
}
