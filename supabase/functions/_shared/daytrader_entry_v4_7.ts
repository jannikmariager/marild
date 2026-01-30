/**
 * DAYTRADER Entry Logic V4.1 (Relaxed SMC Engine)
 * 
 * Based on V4 debug findings:
 * - V4 had 18% capture rate vs V3
 * - Top bottlenecks: price position (99.6% fail), FVG (99.3% fail), liquidity sweep (88.5% fail)
 * 
 * V4.1 Changes:
 * 1. Relaxed price position check (10% buffer around OB zones)
 * 2. FVG from hard filter → soft confluence bonus
 * 3. Liquidity sweep from mandatory → optional confluence bonus
 * 4. Confluence scoring system (need 2+ factors, not all 6)
 * 
 * Target: 40-60% of V3's trade count while keeping SMC methodology
 */

import { OHLCBar } from './signal_types.ts';

// Re-export helper functions from V4
import {
  SwingPoint,
  detectSwingPoints,
  BOSEvent,
  detectBOS,
  LiquiditySweep,
  detectLiquiditySweep,
  OrderBlock,
  detectOrderBlock,
  FVG,
  detectFVG,
  VolatilityRegime,
  getVolatilityRegime,
} from './daytrader_entry_v4.ts';

// ============================================================================
// V4.1 SPECIFIC INTERFACES
// ============================================================================

export interface V4_1EntrySignal {
  should_enter: boolean;
  direction: 'long' | 'short' | 'none';
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  reason: string;
  confluenceScore: number;
  confluenceFactors: string[];
  bos_event?: BOSEvent;
  liquidity_sweep?: LiquiditySweep;
  order_block?: OrderBlock;
  fvg?: FVG;
  volatility_regime?: VolatilityRegime;
}

interface RecentContext {
  recentHigh: number;
  recentLow: number;
  recentMid: number;
}

// ============================================================================
// HELPER: CALCULATE ATR
// ============================================================================

function calculateATR(bars: OHLCBar[], period: number = 14): number {
  if (bars.length < period + 1) return 0;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trueRanges.push(tr);
  }
  
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, tr) => sum + tr, 0) / period;
}

function calculateAvgVolume(bars: OHLCBar[], period: number): number {
  if (bars.length < period) return 0;
  const recentVolumes = bars.slice(-period).map(b => b.volume);
  return recentVolumes.reduce((sum, v) => sum + v, 0) / period;
}

// ============================================================================
// V4.1 RELAXED PRICE POSITION CHECK
// ============================================================================

/**
 * Compute recent context for discount/premium zones
 */
function getRecentContext(bars: OHLCBar[], lookback: number = 50): RecentContext {
  const recentBars = bars.slice(-Math.min(lookback, bars.length));
  const recentHigh = Math.max(...recentBars.map(b => b.high));
  const recentLow = Math.min(...recentBars.map(b => b.low));
  const recentMid = (recentHigh + recentLow) / 2;
  
  return { recentHigh, recentLow, recentMid };
}

/**
 * V4.1 RELAXED: Check if price is in valid zone around order block
 * 
 * OLD V4: Required exact touch/inside OB with strict multipliers (99.6% fail)
 * NEW V4.1: Allow 10% buffer around OB + discount/premium check
 */
function isPriceInValidZone(
  currentBar: OHLCBar,
  orderBlock: OrderBlock,
  context: RecentContext,
  direction: 'bullish' | 'bearish'
): boolean {
  const range = orderBlock.high - orderBlock.low;
  if (range <= 0) return false;
  
  // 10% buffer around order block (relaxed from V4's strict check)
  const buffer = range * 0.10;
  const minAllowed = orderBlock.low - buffer;
  const maxAllowed = orderBlock.high + buffer;
  const close = currentBar.close;
  
  // Must be within buffered zone
  if (close < minAllowed || close > maxAllowed) {
    return false;
  }
  
  // Discount/Premium check (optional, helps quality)
  if (direction === 'bullish') {
    // Long: prefer discount zone (lower half of recent range)
    return close <= context.recentMid * 1.05; // 5% tolerance
  } else {
    // Short: prefer premium zone (upper half of recent range)
    return close >= context.recentMid * 0.95; // 5% tolerance
  }
}

// ============================================================================
// V4.1 CONFLUENCE SCORING SYSTEM
// ============================================================================

interface ConfluenceFactors {
  hasBOS: boolean;
  hasLiquiditySweep: boolean;
  hasOrderBlock: boolean;
  hasFVG: boolean;
  volumeOk: boolean;
  pricePositionOk: boolean;
}

function calculateConfluenceScore(factors: ConfluenceFactors): { score: number; list: string[] } {
  const list: string[] = [];
  let score = 0;
  
  // Core structure factors (weighted higher)
  if (factors.hasBOS) {
    score += 2;
    list.push('BOS');
  }
  
  if (factors.hasOrderBlock) {
    score += 2;
    list.push('OrderBlock');
  }
  
  // Confluence factors (weighted as bonuses)
  if (factors.hasLiquiditySweep) {
    score += 2; // Strong signal when present
    list.push('LiquiditySweep');
  }
  
  if (factors.hasFVG) {
    score += 1; // Bonus, not required
    list.push('FVG');
  }
  
  // Supporting factors
  if (factors.volumeOk) {
    score += 1;
    list.push('Volume');
  }
  
  if (factors.pricePositionOk) {
    score += 1;
    list.push('PricePosition');
  }
  
  return { score, list };
}

// ============================================================================
// V4.1 MAIN ENTRY EVALUATION
// ============================================================================

/**
 * Evaluate DAYTRADER V4.1 entry conditions
 * 
 * V4.1 Philosophy:
 * - Require CORE: BOS + Order Block (4 points)
 * - Require MINIMUM: 5+ confluence points total
 * - OPTIONAL: Liquidity sweep, FVG, volume, price position (bonuses)
 * 
 * This should achieve 40-60% of V3's trade count vs V4's 18%
 */
export function evaluateDaytraderEntryV4_1(
  bars5m: OHLCBar[],
  symbol: string
): V4_1EntrySignal {
  if (bars5m.length < 30) {
    return {
      should_enter: false,
      direction: 'none',
      entry_price: null,
      stop_loss: null,
      take_profit_1: null,
      take_profit_2: null,
      reason: 'Insufficient bars for V4.1 analysis',
      confluenceScore: 0,
      confluenceFactors: []
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const atr = calculateATR(bars5m, 14);
  const avgVolume = calculateAvgVolume(bars5m, 20);
  const recentContext = getRecentContext(bars5m, 50);
  
  // Step 1: Detect swing structure
  const swings = detectSwingPoints(bars5m);
  
  // Step 2: Detect BOS
  const bosEvents = detectBOS(bars5m, swings);
  
  // Step 3: Detect liquidity sweep (optional in V4.1)
  const liquiditySweep = detectLiquiditySweep(bars5m, swings);
  
  // Step 4: Detect order block
  const orderBlock = detectOrderBlock(bars5m, atr);
  
  // Step 5: Detect FVG (optional in V4.1)
  const fvg = detectFVG(bars5m);
  
  // Step 6: Get volatility regime
  const volRegime = getVolatilityRegime(bars5m);
  
  // Step 7: Volume check (relaxed - 0.4x instead of 0.5x)
  const volumeOk = currentBar.volume >= 0.4 * avgVolume;
  
  // ===== LONG SETUP =====
  const bullishBOS = bosEvents.find(b => b.direction === 'bullish');
  const bullishSweep = liquiditySweep?.direction === 'bullish';
  const bullishOB = orderBlock?.direction === 'bullish';
  const bullishFVG = fvg?.direction === 'bullish';
  
  if (bullishBOS && bullishOB) {
    // Core conditions met, now check confluence
    const pricePositionOk = isPriceInValidZone(currentBar, orderBlock!, recentContext, 'bullish');
    
    const factors: ConfluenceFactors = {
      hasBOS: true,
      hasLiquiditySweep: !!bullishSweep,
      hasOrderBlock: true,
      hasFVG: !!bullishFVG,
      volumeOk,
      pricePositionOk
    };
    
    const confluence = calculateConfluenceScore(factors);
    
    // V4.1 threshold: Need 5+ points (vs V4's "all conditions")
    // Core (BOS + OB) = 4 points, need 1+ bonus
    if (confluence.score >= 5) {
      const entryPrice = currentBar.close;
      const stopLoss = orderBlock!.low - (orderBlock!.high - orderBlock!.low) * 0.1;
      const risk = entryPrice - stopLoss;
      const tp1 = entryPrice + risk * 1.5;
      const tp2 = entryPrice + risk * 3.0;
      
      return {
        should_enter: true,
        direction: 'long',
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit_1: tp1,
        take_profit_2: tp2,
        reason: `V4.1 LONG: ${confluence.list.join(' + ')} (score: ${confluence.score})`,
        confluenceScore: confluence.score,
        confluenceFactors: confluence.list,
        bos_event: bullishBOS,
        liquidity_sweep: liquiditySweep || undefined,
        order_block: orderBlock!,
        fvg: fvg || undefined,
        volatility_regime: volRegime
      };
    }
  }
  
  // ===== SHORT SETUP =====
  const bearishBOS = bosEvents.find(b => b.direction === 'bearish');
  const bearishSweep = liquiditySweep?.direction === 'bearish';
  const bearishOB = orderBlock?.direction === 'bearish';
  const bearishFVG = fvg?.direction === 'bearish';
  
  if (bearishBOS && bearishOB) {
    // Core conditions met, now check confluence
    const pricePositionOk = isPriceInValidZone(currentBar, orderBlock!, recentContext, 'bearish');
    
    const factors: ConfluenceFactors = {
      hasBOS: true,
      hasLiquiditySweep: !!bearishSweep,
      hasOrderBlock: true,
      hasFVG: !!bearishFVG,
      volumeOk,
      pricePositionOk
    };
    
    const confluence = calculateConfluenceScore(factors);
    
    // V4.1 threshold: Need 5+ points
    if (confluence.score >= 5) {
      const entryPrice = currentBar.close;
      const stopLoss = orderBlock!.high + (orderBlock!.high - orderBlock!.low) * 0.1;
      const risk = stopLoss - entryPrice;
      const tp1 = entryPrice - risk * 1.5;
      const tp2 = entryPrice - risk * 3.0;
      
      return {
        should_enter: true,
        direction: 'short',
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit_1: tp1,
        take_profit_2: tp2,
        reason: `V4.1 SHORT: ${confluence.list.join(' + ')} (score: ${confluence.score})`,
        confluenceScore: confluence.score,
        confluenceFactors: confluence.list,
        bos_event: bearishBOS,
        liquidity_sweep: liquiditySweep || undefined,
        order_block: orderBlock!,
        fvg: fvg || undefined,
        volatility_regime: volRegime
      };
    }
  }
  
  // No valid entry
  return {
    should_enter: false,
    direction: 'none',
    entry_price: null,
    stop_loss: null,
    take_profit_1: null,
    take_profit_2: null,
    reason: 'V4.1 conditions not met (need BOS + OB + 5+ confluence points)',
    confluenceScore: 0,
    confluenceFactors: []
  };
}
