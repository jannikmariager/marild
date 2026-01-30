/**
 * DAYTRADER Entry Logic V4 (Order Blocks + Liquidity Sweep Engine)
 * 
 * High-volatility engine designed for tickers where v3/v3.5 fail:
 * - META, COIN, IWM, TSLA, AMD, RIVN
 * 
 * Core Methodology:
 * 1. BOS/CHOCH detection (market structure break)
 * 2. Liquidity sweep before entry
 * 3. Order block identification (3-bar reversal)
 * 4. Fair Value Gap (FVG) filter
 * 5. Volatility regime adaptation
 * 
 * Target: High-volatility tickers, 1.5-3R reward/risk, tight stops
 * 
 * ONLY affects engine_type === 'DAYTRADER' with engine_version === 'V4'
 */

import { OHLCBar } from './signal_types.ts';
import { V4DebugFlags } from './daytrader_v4_debug.ts';

// ============================================================================
// HELPER: INDICATOR CALCULATIONS
// ============================================================================

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

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
// SWING STRUCTURE DETECTION
// ============================================================================

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: string;
}

/**
 * Detect swing highs and lows using simple 3-bar pattern
 * Swing High: bar[i] > bar[i-1] AND bar[i] > bar[i+1]
 * Swing Low: bar[i] < bar[i-1] AND bar[i] < bar[i+1]
 */
export function detectSwingPoints(bars: OHLCBar[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  
  for (let i = 1; i < bars.length - 1; i++) {
    // Swing High
    if (bars[i].high > bars[i - 1].high && bars[i].high > bars[i + 1].high) {
      swings.push({
        index: i,
        price: bars[i].high,
        type: 'high',
        timestamp: bars[i].timestamp,
      });
    }
    
    // Swing Low
    if (bars[i].low < bars[i - 1].low && bars[i].low < bars[i + 1].low) {
      swings.push({
        index: i,
        price: bars[i].low,
        type: 'low',
        timestamp: bars[i].timestamp,
      });
    }
  }
  
  return swings;
}

// ============================================================================
// BOS / CHOCH DETECTION (Break of Structure / Change of Character)
// ============================================================================

export interface BOSEvent {
  direction: 'bullish' | 'bearish';
  breakPrice: number;
  breakIndex: number;
  prevSwingPrice: number;
  prevSwingIndex: number;
}

/**
 * Detect BOS (Break of Structure)
 * 
 * Bullish BOS: Price breaks above previous swing high
 * Bearish BOS: Price breaks below previous swing low
 * 
 * Requires:
 * - HL → HH → BOS (long)
 * - LH → LL → BOS (short)
 */
export function detectBOS(bars: OHLCBar[], swings: SwingPoint[]): BOSEvent[] {
  const bosEvents: BOSEvent[] = [];
  
  // Find recent swing highs and lows
  const recentHighs = swings.filter(s => s.type === 'high').slice(-5);
  const recentLows = swings.filter(s => s.type === 'low').slice(-5);
  
  // Check for bullish BOS (break above previous high)
  if (recentHighs.length >= 2) {
    const prevHigh = recentHighs[recentHighs.length - 2];
    const lastBar = bars[bars.length - 1];
    
    if (lastBar.close > prevHigh.price) {
      bosEvents.push({
        direction: 'bullish',
        breakPrice: lastBar.close,
        breakIndex: bars.length - 1,
        prevSwingPrice: prevHigh.price,
        prevSwingIndex: prevHigh.index,
      });
    }
  }
  
  // Check for bearish BOS (break below previous low)
  if (recentLows.length >= 2) {
    const prevLow = recentLows[recentLows.length - 2];
    const lastBar = bars[bars.length - 1];
    
    if (lastBar.close < prevLow.price) {
      bosEvents.push({
        direction: 'bearish',
        breakPrice: lastBar.close,
        breakIndex: bars.length - 1,
        prevSwingPrice: prevLow.price,
        prevSwingIndex: prevLow.index,
      });
    }
  }
  
  return bosEvents;
}

// ============================================================================
// LIQUIDITY SWEEP DETECTION
// ============================================================================

export interface LiquiditySweep {
  direction: 'bullish' | 'bearish';
  sweepPrice: number;
  closePrice: number;
  barIndex: number;
  sweptLevel: number;
}

/**
 * Detect liquidity sweep
 * 
 * Bullish sweep (long setup):
 * - Wick takes out previous swing low
 * - Candle closes back inside structure (above the low)
 * 
 * Bearish sweep (short setup):
 * - Wick takes out previous swing high
 * - Candle closes back inside structure (below the high)
 */
export function detectLiquiditySweep(
  bars: OHLCBar[],
  swings: SwingPoint[]
): LiquiditySweep | null {
  if (bars.length < 5 || swings.length < 2) return null;
  
  const lastBar = bars[bars.length - 1];
  const recentHighs = swings.filter(s => s.type === 'high').slice(-3);
  const recentLows = swings.filter(s => s.type === 'low').slice(-3);
  
  // Check for bullish sweep (wick below prev low, close above)
  if (recentLows.length >= 1) {
    const prevLow = recentLows[recentLows.length - 1];
    
    if (lastBar.low < prevLow.price && lastBar.close > prevLow.price) {
      return {
        direction: 'bullish',
        sweepPrice: lastBar.low,
        closePrice: lastBar.close,
        barIndex: bars.length - 1,
        sweptLevel: prevLow.price,
      };
    }
  }
  
  // Check for bearish sweep (wick above prev high, close below)
  if (recentHighs.length >= 1) {
    const prevHigh = recentHighs[recentHighs.length - 1];
    
    if (lastBar.high > prevHigh.price && lastBar.close < prevHigh.price) {
      return {
        direction: 'bearish',
        sweepPrice: lastBar.high,
        closePrice: lastBar.close,
        barIndex: bars.length - 1,
        sweptLevel: prevHigh.price,
      };
    }
  }
  
  return null;
}

// ============================================================================
// ORDER BLOCK DETECTION (3-bar reversal)
// ============================================================================

export interface OrderBlock {
  direction: 'bullish' | 'bearish';
  high: number;
  low: number;
  body_high: number;
  body_low: number;
  barIndex: number;
  displacement: number;
  valid: boolean;
}

/**
 * Detect Order Block (OB)
 * 
 * Bullish OB:
 * - Last bearish candle before displacement up
 * - OB zone = candle body ± wick buffer (10%)
 * 
 * Bearish OB:
 * - Last bullish candle before displacement down
 * 
 * Displacement requirement: Move ≥ 0.3× ATR
 */
export function detectOrderBlock(bars: OHLCBar[], atr: number): OrderBlock | null {
  if (bars.length < 5) return null;
  
  const displacementThreshold = 0.3 * atr;
  
  // Check for bullish OB (last bearish before up move)
  for (let i = bars.length - 3; i >= Math.max(0, bars.length - 10); i--) {
    const obCandle = bars[i];
    
    // Must be bearish candle
    if (obCandle.close >= obCandle.open) continue;
    
    // Check for displacement up in next candles
    let displacement = 0;
    for (let j = i + 1; j < Math.min(i + 4, bars.length); j++) {
      displacement = Math.max(displacement, bars[j].high - obCandle.low);
    }
    
    if (displacement >= displacementThreshold) {
      const wickBuffer = (obCandle.high - obCandle.low) * 0.1;
      
      return {
        direction: 'bullish',
        high: obCandle.high + wickBuffer,
        low: obCandle.low - wickBuffer,
        body_high: Math.max(obCandle.open, obCandle.close),
        body_low: Math.min(obCandle.open, obCandle.close),
        barIndex: i,
        displacement,
        valid: true,
      };
    }
  }
  
  // Check for bearish OB (last bullish before down move)
  for (let i = bars.length - 3; i >= Math.max(0, bars.length - 10); i--) {
    const obCandle = bars[i];
    
    // Must be bullish candle
    if (obCandle.close <= obCandle.open) continue;
    
    // Check for displacement down in next candles
    let displacement = 0;
    for (let j = i + 1; j < Math.min(i + 4, bars.length); j++) {
      displacement = Math.max(displacement, obCandle.high - bars[j].low);
    }
    
    if (displacement >= displacementThreshold) {
      const wickBuffer = (obCandle.high - obCandle.low) * 0.1;
      
      return {
        direction: 'bearish',
        high: obCandle.high + wickBuffer,
        low: obCandle.low - wickBuffer,
        body_high: Math.max(obCandle.open, obCandle.close),
        body_low: Math.min(obCandle.open, obCandle.close),
        barIndex: i,
        displacement,
        valid: true,
      };
    }
  }
  
  return null;
}

// ============================================================================
// FVG (Fair Value Gap) DETECTION
// ============================================================================

export interface FVG {
  direction: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  startIndex: number;
  filled: boolean;
}

/**
 * Detect Fair Value Gap (FVG)
 * 
 * Bullish FVG: Gap between candle 1 low and candle 3 high (upward gap)
 * Bearish FVG: Gap between candle 1 high and candle 3 low (downward gap)
 */
export function detectFVG(bars: OHLCBar[]): FVG | null {
  if (bars.length < 3) return null;
  
  const idx = bars.length - 3;
  const bar1 = bars[idx];
  const bar2 = bars[idx + 1];
  const bar3 = bars[idx + 2];
  
  // Bullish FVG: bar3.high < bar1.low (gap down that needs filling)
  if (bar3.high < bar1.low) {
    const currentPrice = bars[bars.length - 1].close;
    const filled = currentPrice >= bar3.high && currentPrice <= bar1.low;
    
    return {
      direction: 'bullish',
      top: bar1.low,
      bottom: bar3.high,
      startIndex: idx,
      filled,
    };
  }
  
  // Bearish FVG: bar3.low > bar1.high (gap up that needs filling)
  if (bar3.low > bar1.high) {
    const currentPrice = bars[bars.length - 1].close;
    const filled = currentPrice <= bar3.low && currentPrice >= bar1.high;
    
    return {
      direction: 'bearish',
      top: bar3.low,
      bottom: bar1.high,
      startIndex: idx,
      filled,
    };
  }
  
  return null;
}

// ============================================================================
// VOLATILITY REGIME ADAPTATION
// ============================================================================

export interface VolatilityRegime {
  regime: 'high' | 'normal' | 'low';
  atr_current: number;
  atr_baseline: number;
  atr_ratio: number;
  ob_zone_multiplier: number;
  fvg_zone_multiplier: number;
  entry_delay: number;
}

/**
 * Compute volatility regime and adapt parameters
 * 
 * High volatility (ATR > 1.8× baseline):
 * - Widen OB zone by +20%
 * - Widen FVG zone by +30%
 * - Delay entry by 1 candle
 * 
 * Low volatility (ATR < 0.7× baseline):
 * - Tighten OB by 20%
 * - Remove FVG requirement
 */
export function getVolatilityRegime(bars: OHLCBar[]): VolatilityRegime {
  const atrCurrent = calculateATR(bars, 14);
  const atrBaseline = calculateATR(bars, 20);
  const atrRatio = atrBaseline > 0 ? atrCurrent / atrBaseline : 1;
  
  if (atrRatio > 1.8) {
    return {
      regime: 'high',
      atr_current: atrCurrent,
      atr_baseline: atrBaseline,
      atr_ratio: atrRatio,
      ob_zone_multiplier: 1.2,
      fvg_zone_multiplier: 1.3,
      entry_delay: 1,
    };
  } else if (atrRatio < 0.7) {
    return {
      regime: 'low',
      atr_current: atrCurrent,
      atr_baseline: atrBaseline,
      atr_ratio: atrRatio,
      ob_zone_multiplier: 0.8,
      fvg_zone_multiplier: 1.0,
      entry_delay: 0,
    };
  } else {
    return {
      regime: 'normal',
      atr_current: atrCurrent,
      atr_baseline: atrBaseline,
      atr_ratio: atrRatio,
      ob_zone_multiplier: 1.0,
      fvg_zone_multiplier: 1.0,
      entry_delay: 0,
    };
  }
}

// ============================================================================
// FINAL ENTRY EVALUATION V4
// ============================================================================

export interface V4EntrySignal {
  is_valid: boolean;
  direction: 'long' | 'short' | 'none';
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  reason: string;
  bos_event?: BOSEvent;
  liquidity_sweep?: LiquiditySweep;
  order_block?: OrderBlock;
  fvg?: FVG;
  volatility_regime?: VolatilityRegime;
  debug?: V4DebugFlags;
}

export interface V4EntrySignalWithDebug extends V4EntrySignal {
  should_enter: boolean;
}

/**
 * Evaluate DAYTRADER V4 entry conditions
 * 
 * LONG conditions (ALL must be true):
 * 1. BOS up
 * 2. Liquidity sweep down
 * 3. OB OR FVG signal exists
 * 4. Candle closes above OB zone
 * 5. ATR regime allows entry
 * 6. No opposite OB in last 5 candles
 * 7. Volume ≥ 0.5× average
 * 
 * SHORT = mirror logic
 */
export function evaluateDaytraderEntryV4(
  bars5m: OHLCBar[],
  symbol: string
): V4EntrySignal {
  if (bars5m.length < 30) {
    return {
      is_valid: false,
      direction: 'none',
      entry_price: null,
      stop_loss: null,
      take_profit_1: null,
      take_profit_2: null,
      reason: 'Insufficient bars for V4 analysis',
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const atr = calculateATR(bars5m, 14);
  const avgVolume = calculateAvgVolume(bars5m, 20);
  
  // Step 1: Detect swing structure
  const swings = detectSwingPoints(bars5m);
  
  // Step 2: Detect BOS
  const bosEvents = detectBOS(bars5m, swings);
  
  // Step 3: Detect liquidity sweep
  const liquiditySweep = detectLiquiditySweep(bars5m, swings);
  
  // Step 4: Detect order block
  const orderBlock = detectOrderBlock(bars5m, atr);
  
  // Step 5: Detect FVG
  const fvg = detectFVG(bars5m);
  
  // Step 6: Get volatility regime
  const volRegime = getVolatilityRegime(bars5m);
  
  // Step 7: Volume check
  const volumeOk = currentBar.volume >= 0.5 * avgVolume;
  
  // ===== LONG SETUP =====
  const bullishBOS = bosEvents.find(b => b.direction === 'bullish');
  const bullishSweep = liquiditySweep?.direction === 'bullish';
  const bullishOB = orderBlock?.direction === 'bullish';
  const bullishFVG = fvg?.direction === 'bullish';
  
  if (bullishBOS && bullishSweep && (bullishOB || bullishFVG) && volumeOk) {
    // Check if price closed above OB zone (if OB exists)
    let aboveOB = true;
    if (bullishOB && orderBlock) {
      const obHigh = orderBlock.high * volRegime.ob_zone_multiplier;
      aboveOB = currentBar.close > obHigh;
    }
    
    // Check FVG filled (if FVG exists and regime requires it)
    let fvgCondition = true;
    if (bullishFVG && fvg && volRegime.regime !== 'low') {
      fvgCondition = fvg.filled;
    }
    
    if (aboveOB && fvgCondition) {
      // Entry confirmed
      const entryPrice = currentBar.close;
      const stopLoss = orderBlock ? orderBlock.low : liquiditySweep!.sweepPrice;
      const risk = entryPrice - stopLoss;
      const tp1 = entryPrice + risk * 1.5;
      const tp2 = entryPrice + risk * 3.0;
      
      return {
        is_valid: true,
        direction: 'long',
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit_1: tp1,
        take_profit_2: tp2,
        reason: `V4 LONG: BOS up + liquidity sweep + OB/FVG + ${volRegime.regime} vol`,
        bos_event: bullishBOS,
        liquidity_sweep: liquiditySweep!,
        order_block: orderBlock || undefined,
        fvg: fvg || undefined,
        volatility_regime: volRegime,
      };
    }
  }
  
  // ===== SHORT SETUP =====
  const bearishBOS = bosEvents.find(b => b.direction === 'bearish');
  const bearishSweep = liquiditySweep?.direction === 'bearish';
  const bearishOB = orderBlock?.direction === 'bearish';
  const bearishFVG = fvg?.direction === 'bearish';
  
  if (bearishBOS && bearishSweep && (bearishOB || bearishFVG) && volumeOk) {
    // Check if price closed below OB zone (if OB exists)
    let belowOB = true;
    if (bearishOB && orderBlock) {
      const obLow = orderBlock.low * volRegime.ob_zone_multiplier;
      belowOB = currentBar.close < obLow;
    }
    
    // Check FVG filled (if FVG exists and regime requires it)
    let fvgCondition = true;
    if (bearishFVG && fvg && volRegime.regime !== 'low') {
      fvgCondition = fvg.filled;
    }
    
    if (belowOB && fvgCondition) {
      // Entry confirmed
      const entryPrice = currentBar.close;
      const stopLoss = orderBlock ? orderBlock.high : liquiditySweep!.sweepPrice;
      const risk = stopLoss - entryPrice;
      const tp1 = entryPrice - risk * 1.5;
      const tp2 = entryPrice - risk * 3.0;
      
      return {
        is_valid: true,
        direction: 'short',
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit_1: tp1,
        take_profit_2: tp2,
        reason: `V4 SHORT: BOS down + liquidity sweep + OB/FVG + ${volRegime.regime} vol`,
        bos_event: bearishBOS,
        liquidity_sweep: liquiditySweep!,
        order_block: orderBlock || undefined,
        fvg: fvg || undefined,
        volatility_regime: volRegime,
      };
    }
  }
  
  // No valid entry
  return {
    is_valid: false,
    direction: 'none',
    entry_price: null,
    stop_loss: null,
    take_profit_1: null,
    take_profit_2: null,
    reason: 'V4 conditions not met (missing BOS, sweep, OB/FVG, or volume)',
  };
}

/**
 * Debug version of V4 entry evaluation
 * Returns detailed flags for every condition checked
 */
export function evaluateDaytraderEntryV4WithDebug(
  bars5m: OHLCBar[],
  symbol: string,
  barIndex: number
): V4EntrySignalWithDebug {
  const baseSignal = evaluateDaytraderEntryV4(bars5m, symbol);
  
  if (bars5m.length < 30) {
    return {
      ...baseSignal,
      should_enter: false,
      debug: {
        barIndex,
        timestamp: bars5m[bars5m.length - 1]?.timestamp || '',
        price: bars5m[bars5m.length - 1]?.close || 0,
        bosOk: false,
        liquiditySweepOk: false,
        orderBlockOrFvgOk: false,
        volumeOk: false,
        pricePositionOk: false,
        fvgConditionOk: false,
        hasBullishBOS: false,
        hasBearishBOS: false,
        hasBullishSweep: false,
        hasBearishSweep: false,
        hasBullishOB: false,
        hasBearishOB: false,
        hasBullishFVG: false,
        hasBearishFVG: false,
        currentVolume: 0,
        avgVolume: 0,
        volRegime: 'unknown',
        atrRatio: 0,
        allConditionsMet: false,
        direction: 'none',
        reason: 'Insufficient bars'
      }
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const atr = calculateATR(bars5m, 14);
  const avgVolume = calculateAvgVolume(bars5m, 20);
  
  // Step 1: Detect swing structure
  const swings = detectSwingPoints(bars5m);
  
  // Step 2: Detect BOS
  const bosEvents = detectBOS(bars5m, swings);
  
  // Step 3: Detect liquidity sweep
  const liquiditySweep = detectLiquiditySweep(bars5m, swings);
  
  // Step 4: Detect order block
  const orderBlock = detectOrderBlock(bars5m, atr);
  
  // Step 5: Detect FVG
  const fvg = detectFVG(bars5m);
  
  // Step 6: Get volatility regime
  const volRegime = getVolatilityRegime(bars5m);
  
  // Step 7: Volume check
  const volumeOk = currentBar.volume >= 0.5 * avgVolume;
  
  // Check all conditions
  const bullishBOS = bosEvents.find(b => b.direction === 'bullish');
  const bearishBOS = bosEvents.find(b => b.direction === 'bearish');
  const bullishSweep = liquiditySweep?.direction === 'bullish';
  const bearishSweep = liquiditySweep?.direction === 'bearish';
  const bullishOB = orderBlock?.direction === 'bullish';
  const bearishOB = orderBlock?.direction === 'bearish';
  const bullishFVG = fvg?.direction === 'bullish';
  const bearishFVG = fvg?.direction === 'bearish';
  
  // Long setup checks
  let longBosOk = false;
  let longSweepOk = false;
  let longOBOrFVGOk = false;
  let longPricePositionOk = false;
  let longFvgConditionOk = false;
  
  if (bullishBOS && bullishSweep && (bullishOB || bullishFVG) && volumeOk) {
    longBosOk = true;
    longSweepOk = true;
    longOBOrFVGOk = true;
    
    // Check price position
    if (bullishOB && orderBlock) {
      const obHigh = orderBlock.high * volRegime.ob_zone_multiplier;
      longPricePositionOk = currentBar.close > obHigh;
    } else {
      longPricePositionOk = true;
    }
    
    // Check FVG condition
    if (bullishFVG && fvg && volRegime.regime !== 'low') {
      longFvgConditionOk = fvg.filled;
    } else {
      longFvgConditionOk = true;
    }
  }
  
  // Short setup checks
  let shortBosOk = false;
  let shortSweepOk = false;
  let shortOBOrFVGOk = false;
  let shortPricePositionOk = false;
  let shortFvgConditionOk = false;
  
  if (bearishBOS && bearishSweep && (bearishOB || bearishFVG) && volumeOk) {
    shortBosOk = true;
    shortSweepOk = true;
    shortOBOrFVGOk = true;
    
    // Check price position
    if (bearishOB && orderBlock) {
      const obLow = orderBlock.low * volRegime.ob_zone_multiplier;
      shortPricePositionOk = currentBar.close < obLow;
    } else {
      shortPricePositionOk = true;
    }
    
    // Check FVG condition
    if (bearishFVG && fvg && volRegime.regime !== 'low') {
      shortFvgConditionOk = fvg.filled;
    } else {
      shortFvgConditionOk = true;
    }
  }
  
  // Determine final flags
  const longSetupValid = longBosOk && longSweepOk && longOBOrFVGOk && volumeOk && longPricePositionOk && longFvgConditionOk;
  const shortSetupValid = shortBosOk && shortSweepOk && shortOBOrFVGOk && volumeOk && shortPricePositionOk && shortFvgConditionOk;
  
  const debugFlags: V4DebugFlags = {
    barIndex,
    timestamp: currentBar.timestamp,
    price: currentBar.close,
    
    // Aggregate conditions (use best case from long/short)
    bosOk: !!bullishBOS || !!bearishBOS,
    liquiditySweepOk: !!bullishSweep || !!bearishSweep,
    orderBlockOrFvgOk: !!bullishOB || !!bearishOB || !!bullishFVG || !!bearishFVG,
    volumeOk,
    pricePositionOk: longPricePositionOk || shortPricePositionOk,
    fvgConditionOk: longFvgConditionOk || shortFvgConditionOk,
    
    // Detailed breakdowns
    hasBullishBOS: !!bullishBOS,
    hasBearishBOS: !!bearishBOS,
    hasBullishSweep: !!bullishSweep,
    hasBearishSweep: !!bearishSweep,
    hasBullishOB: !!bullishOB,
    hasBearishOB: !!bearishOB,
    hasBullishFVG: !!bullishFVG,
    hasBearishFVG: !!bearishFVG,
    
    currentVolume: currentBar.volume,
    avgVolume,
    volRegime: volRegime.regime,
    atrRatio: volRegime.atr_ratio,
    
    allConditionsMet: longSetupValid || shortSetupValid,
    direction: longSetupValid ? 'long' : (shortSetupValid ? 'short' : 'none'),
    reason: baseSignal.reason
  };
  
  return {
    ...baseSignal,
    should_enter: baseSignal.is_valid,
    debug: debugFlags
  };
}
