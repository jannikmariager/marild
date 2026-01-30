/**
 * DAYTRADER Entry Logic v2 (Phase 2)
 * 
 * Clean momentum-based intraday strategy for 5m/15m candles:
 * - EMA8 for direction, EMA21 as trend filter
 * - Two setup types: Breakout Continuation, Pullback Continuation
 * - Relaxed volume/volatility filters
 * - No SMC, no heavy technical filters
 * 
 * ONLY affects engine_type === 'DAYTRADER'
 * DOES NOT touch SWING or INVESTOR
 */

import { OHLCBar } from './signal_types.ts';

// ============================================================================
// HELPER: INDICATOR CALCULATIONS
// ============================================================================

/**
 * Calculate EMA
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

/**
 * Calculate ATR
 */
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

/**
 * Calculate average volume
 */
function calculateAvgVolume(bars: OHLCBar[], period: number): number {
  if (bars.length < period) return 0;
  const recentVolumes = bars.slice(-period).map(b => b.volume);
  return recentVolumes.reduce((sum, v) => sum + v, 0) / period;
}

// ============================================================================
// MARKET FILTERS
// ============================================================================

export interface MarketFilters {
  volume_ok: boolean;
  volatility_ok: boolean;
  volume_ratio: number;
  vol_ratio: number;
}

/**
 * Check basic market filters for DAYTRADER
 * - Volume >= 0.7x average (relaxed from 0.8x)
 * - Volatility between 0.2% and 3% (ATR/price)
 */
export function checkDaytraderMarketFilters(
  bars5m: OHLCBar[],
  minBars: number = 20
): MarketFilters {
  if (bars5m.length < minBars) {
    return {
      volume_ok: false,
      volatility_ok: false,
      volume_ratio: 0,
      vol_ratio: 0,
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const avgVolume = calculateAvgVolume(bars5m, 20);
  const atr = calculateATR(bars5m, 14);
  
  const volumeRatio = currentBar.volume / avgVolume;
  const volRatio = atr / currentBar.close;
  
  return {
    volume_ok: volumeRatio >= 0.7,
    volatility_ok: volRatio >= 0.002 && volRatio <= 0.03,
    volume_ratio: volumeRatio,
    vol_ratio: volRatio,
  };
}

// ============================================================================
// TREND DETECTION
// ============================================================================

export interface TrendState {
  long_active: boolean;
  short_active: boolean;
  ema8_5m: number;
  ema21_5m: number;
  ema21_15m: number;
  close_5m: number;
  close_15m: number;
}

/**
 * Determine DAYTRADER trend direction using EMA8/21 on 5m and EMA21 on 15m
 * 
 * LONG TREND: EMA8_5m > EMA21_5m AND close_5m > EMA21_5m AND close_15m > EMA21_15m
 * SHORT TREND: EMA8_5m < EMA21_5m AND close_5m < EMA21_5m AND close_15m < EMA21_15m
 */
export function getDaytraderTrend(
  bars5m: OHLCBar[],
  bars15m: OHLCBar[]
): TrendState {
  if (bars5m.length < 21 || bars15m.length < 21) {
    return {
      long_active: false,
      short_active: false,
      ema8_5m: 0,
      ema21_5m: 0,
      ema21_15m: 0,
      close_5m: 0,
      close_15m: 0,
    };
  }
  
  const closes5m = bars5m.map(b => b.close);
  const closes15m = bars15m.map(b => b.close);
  
  const ema8_5m = calculateEMA(closes5m, 8);
  const ema21_5m = calculateEMA(closes5m, 21);
  const ema21_15m = calculateEMA(closes15m, 21);
  
  const close_5m = closes5m[closes5m.length - 1];
  const close_15m = closes15m[closes15m.length - 1];
  
  // Relax trend filter: make 15m confirmation optional (OR instead of AND)
  // This allows more trades while still having directional filter
  const long_active = 
    ema8_5m > ema21_5m &&
    close_5m > ema21_5m &&
    (close_15m > ema21_15m || bars15m.length < 21); // Optional HTF confirmation
  
  const short_active =
    ema8_5m < ema21_5m &&
    close_5m < ema21_5m &&
    (close_15m < ema21_15m || bars15m.length < 21); // Optional HTF confirmation
  
  return {
    long_active,
    short_active,
    ema8_5m,
    ema21_5m,
    ema21_15m,
    close_5m,
    close_15m,
  };
}

// ============================================================================
// SETUP TYPE A: BREAKOUT CONTINUATION
// ============================================================================

export interface BreakoutSetup {
  is_valid: boolean;
  direction: 'long' | 'short' | 'none';
  consolidation_tight: boolean;
  volume_spike: boolean;
  close_strength: boolean;
  reason: string;
}

/**
 * Detect BREAKOUT CONTINUATION setup for DAYTRADER
 * 
 * LONG: consolidation window (6-12 bars), range <= 1.2x ATR, EMA8 > EMA21,
 *       current close > window_high, close in top 30% of bar, volume >= 1.3x avg
 * 
 * SHORT: mirror with inverted conditions
 */
export function checkBreakoutContinuation(
  bars5m: OHLCBar[],
  trend: TrendState,
  filters: MarketFilters
): BreakoutSetup {
  const windowSize = 10; // 6-12 candles, using 10 as middle
  
  if (bars5m.length < 21 + windowSize) {
    return {
      is_valid: false,
      direction: 'none',
      consolidation_tight: false,
      volume_spike: false,
      close_strength: false,
      reason: 'Insufficient bars for breakout setup',
    };
  }
  
  if (!filters.volume_ok || !filters.volatility_ok) {
    return {
      is_valid: false,
      direction: 'none',
      consolidation_tight: false,
      volume_spike: false,
      close_strength: false,
      reason: 'Market filters failed',
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const windowBars = bars5m.slice(-windowSize - 1, -1); // Previous N bars
  
  const atr = calculateATR(bars5m, 14);
  const avgVolume = calculateAvgVolume(bars5m, 20);
  
  // Check consolidation tightness (relaxed from 1.2x to 1.5x ATR)
  const highs = windowBars.map(b => b.high);
  const lows = windowBars.map(b => b.low);
  const windowHigh = Math.max(...highs);
  const windowLow = Math.min(...lows);
  const range = windowHigh - windowLow;
  const consolidation_tight = range <= 1.5 * atr;
  
  // Check volume spike (relaxed from 1.3x to 1.1x)
  const volume_spike = currentBar.volume >= 1.1 * avgVolume;
  
  // Check close strength (top/bottom 30% of bar)
  const barRange = currentBar.high - currentBar.low;
  const closePosition = barRange > 0 
    ? (currentBar.close - currentBar.low) / barRange 
    : 0.5;
  
  // LONG breakout (relax close position from 0.7 to 0.6 = top 40%)
  if (trend.long_active && consolidation_tight) {
    const broke_above = currentBar.close > windowHigh;
    const close_strength = closePosition >= 0.6; // top 40%
    
    if (broke_above && close_strength && volume_spike) {
      return {
        is_valid: true,
        direction: 'long',
        consolidation_tight: true,
        volume_spike: true,
        close_strength: true,
        reason: `Breakout above ${windowHigh.toFixed(2)}, volume ${filters.volume_ratio.toFixed(1)}x, close ${(closePosition * 100).toFixed(0)}%`,
      };
    }
  }
  
  // SHORT breakout (relax close position from 0.3 to 0.4 = bottom 40%)
  if (trend.short_active && consolidation_tight) {
    const broke_below = currentBar.close < windowLow;
    const close_strength = closePosition <= 0.4; // bottom 40%
    
    if (broke_below && close_strength && volume_spike) {
      return {
        is_valid: true,
        direction: 'short',
        consolidation_tight: true,
        volume_spike: true,
        close_strength: true,
        reason: `Breakout below ${windowLow.toFixed(2)}, volume ${filters.volume_ratio.toFixed(1)}x, close ${(closePosition * 100).toFixed(0)}%`,
      };
    }
  }
  
  return {
    is_valid: false,
    direction: 'none',
    consolidation_tight,
    volume_spike,
    close_strength: false,
    reason: 'No breakout confirmation',
  };
}

// ============================================================================
// SETUP TYPE B: PULLBACK CONTINUATION
// ============================================================================

export interface PullbackSetup {
  is_valid: boolean;
  direction: 'long' | 'short' | 'none';
  touched_ema21: boolean;
  rejection_candle: boolean;
  close_above_ema8: boolean;
  entry_trigger_price: number | null;
  reason: string;
}

/**
 * Detect PULLBACK CONTINUATION setup for DAYTRADER
 * 
 * LONG: price touches EMA21, bullish rejection candle (long lower wick >= 40% of range),
 *       close > EMA8, close in top 40% of bar
 *       Entry: next candle breaks above rejection high
 * 
 * SHORT: mirror with inverted conditions
 */
export function checkPullbackContinuation(
  bars5m: OHLCBar[],
  trend: TrendState,
  filters: MarketFilters
): PullbackSetup {
  if (bars5m.length < 21) {
    return {
      is_valid: false,
      direction: 'none',
      touched_ema21: false,
      rejection_candle: false,
      close_above_ema8: false,
      entry_trigger_price: null,
      reason: 'Insufficient bars for pullback setup',
    };
  }
  
  if (!filters.volume_ok || !filters.volatility_ok) {
    return {
      is_valid: false,
      direction: 'none',
      touched_ema21: false,
      rejection_candle: false,
      close_above_ema8: false,
      entry_trigger_price: null,
      reason: 'Market filters failed',
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const prevBar = bars5m[bars5m.length - 2];
  
  // Check if price touched EMA21 (current or previous bar)
  const touched_ema21_current = currentBar.low <= trend.ema21_5m;
  const touched_ema21_prev = prevBar && prevBar.low <= trend.ema21_5m;
  const touched_ema21 = touched_ema21_current || touched_ema21_prev;
  
  // LONG pullback (relax wick requirement from 40% to 30%)
  if (trend.long_active && touched_ema21) {
    const barRange = currentBar.high - currentBar.low;
    const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
    const rejection_candle = barRange > 0 && lowerWick >= 0.3 * barRange;
    
    const close_above_ema8 = currentBar.close > trend.ema8_5m;
    
    const closePosition = barRange > 0 
      ? (currentBar.close - currentBar.low) / barRange 
      : 0.5;
    const close_strength = closePosition >= 0.6; // top 40%
    
    if (rejection_candle && close_above_ema8 && close_strength) {
      return {
        is_valid: true,
        direction: 'long',
        touched_ema21: true,
        rejection_candle: true,
        close_above_ema8: true,
        entry_trigger_price: currentBar.high, // Entry on break of rejection high
        reason: `Bullish rejection at EMA21 (${trend.ema21_5m.toFixed(2)}), wick ${(lowerWick / barRange * 100).toFixed(0)}%, close ${(closePosition * 100).toFixed(0)}%`,
      };
    }
  }
  
  // SHORT pullback (relax wick requirement from 40% to 30%)
  if (trend.short_active && (currentBar.high >= trend.ema21_5m || (prevBar && prevBar.high >= trend.ema21_5m))) {
    const barRange = currentBar.high - currentBar.low;
    const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
    const rejection_candle = barRange > 0 && upperWick >= 0.3 * barRange;
    
    const close_below_ema8 = currentBar.close < trend.ema8_5m;
    
    const closePosition = barRange > 0 
      ? (currentBar.close - currentBar.low) / barRange 
      : 0.5;
    const close_strength = closePosition <= 0.4; // bottom 40%
    
    if (rejection_candle && close_below_ema8 && close_strength) {
      return {
        is_valid: true,
        direction: 'short',
        touched_ema21: true,
        rejection_candle: true,
        close_above_ema8: false,
        entry_trigger_price: currentBar.low, // Entry on break of rejection low
        reason: `Bearish rejection at EMA21 (${trend.ema21_5m.toFixed(2)}), wick ${(upperWick / barRange * 100).toFixed(0)}%, close ${(closePosition * 100).toFixed(0)}%`,
      };
    }
  }
  
  return {
    is_valid: false,
    direction: 'none',
    touched_ema21,
    rejection_candle: false,
    close_above_ema8: false,
    entry_trigger_price: null,
    reason: 'No pullback rejection pattern',
  };
}

// ============================================================================
// UNIFIED ENTRY EVALUATION
// ============================================================================

export interface DaytraderEntrySignal {
  should_enter: boolean;
  direction: 'long' | 'short' | 'none';
  setup_type: 'breakout' | 'pullback' | 'none';
  entry_price: number | null;
  reason: string;
  trend: TrendState;
  filters: MarketFilters;
}

/**
 * Evaluate DAYTRADER v2 entry for 5m/15m candles
 * Checks trend, filters, then both breakout and pullback setups
 */
export function evaluateDaytraderEntryV2(
  bars5m: OHLCBar[],
  bars15m: OHLCBar[]
): DaytraderEntrySignal {
  // Check trend
  const trend = getDaytraderTrend(bars5m, bars15m);
  
  if (!trend.long_active && !trend.short_active) {
    return {
      should_enter: false,
      direction: 'none',
      setup_type: 'none',
      entry_price: null,
      reason: 'No clear trend (EMA8/21 alignment)',
      trend,
      filters: checkDaytraderMarketFilters(bars5m),
    };
  }
  
  // Check market filters
  const filters = checkDaytraderMarketFilters(bars5m);
  
  if (!filters.volume_ok || !filters.volatility_ok) {
    return {
      should_enter: false,
      direction: 'none',
      setup_type: 'none',
      entry_price: null,
      reason: `Market filters: volume ${filters.volume_ok ? 'OK' : 'LOW'}, volatility ${filters.volatility_ok ? 'OK' : 'EXTREME'}`,
      trend,
      filters,
    };
  }
  
  // Check breakout setup (priority 1)
  const breakout = checkBreakoutContinuation(bars5m, trend, filters);
  if (breakout.is_valid) {
    return {
      should_enter: true,
      direction: breakout.direction,
      setup_type: 'breakout',
      entry_price: bars5m[bars5m.length - 1].close, // Entry at close of breakout bar
      reason: `BREAKOUT: ${breakout.reason}`,
      trend,
      filters,
    };
  }
  
  // Check pullback setup (priority 2)
  const pullback = checkPullbackContinuation(bars5m, trend, filters);
  if (pullback.is_valid) {
    return {
      should_enter: true,
      direction: pullback.direction,
      setup_type: 'pullback',
      entry_price: pullback.entry_trigger_price, // Entry on break of rejection high/low
      reason: `PULLBACK: ${pullback.reason}`,
      trend,
      filters,
    };
  }
  
  return {
    should_enter: false,
    direction: 'none',
    setup_type: 'none',
    entry_price: null,
    reason: 'No valid breakout or pullback setup',
    trend,
    filters,
  };
}
