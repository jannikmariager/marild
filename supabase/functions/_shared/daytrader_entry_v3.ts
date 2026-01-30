/**
 * DAYTRADER Entry Logic v3 (Phase 3 - Optimization)
 * 
 * Loosened filters and new micro-breakout logic to increase trade frequency:
 * - NEW: Micro-breakout (break of previous candle high/low)
 * - LOOSER: Breakout continuation (2.0x ATR, no volume spike)
 * - SIMPLIFIED: Pullback continuation (touch EMA21, no wick requirements)
 * - REMOVED: 15m HTF confirmation
 * 
 * Target: 40-120 trades/30d, 35-55% win rate, +0.10 to +0.30 avgR
 * 
 * ONLY affects engine_type === 'DAYTRADER'
 * DOES NOT touch SWING or INVESTOR
 */

import { OHLCBar } from './signal_types.ts';

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
// MARKET FILTERS (LOOSER)
// ============================================================================

export interface MarketFilters {
  volume_ok: boolean;
  volatility_ok: boolean;
  volume_ratio: number;
  vol_ratio: number;
  ema_squeeze: boolean;
}

/**
 * Check base market filters for DAYTRADER v3
 * - Volume >= 0.7x average
 * - Volatility between 0.1% and 3% (relaxed from 0.2%)
 * - EMA squeeze detection (EMA8/21 within 0.2% = high breakout potential)
 */
export function checkDaytraderMarketFiltersV3(
  bars5m: OHLCBar[],
  ema8: number,
  ema21: number,
  minBars: number = 20
): MarketFilters {
  if (bars5m.length < minBars) {
    return {
      volume_ok: false,
      volatility_ok: false,
      volume_ratio: 0,
      vol_ratio: 0,
      ema_squeeze: false,
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const avgVolume = calculateAvgVolume(bars5m, 20);
  const atr = calculateATR(bars5m, 14);
  
  const volumeRatio = currentBar.volume / avgVolume;
  const volRatio = atr / currentBar.close;
  
  // EMA squeeze: when EMA8 and EMA21 are within 0.2% of each other
  const emaDist = Math.abs(ema8 - ema21) / currentBar.close;
  const ema_squeeze = emaDist <= 0.002;
  
  // If EMA squeeze, allow slightly lower volume
  const volumeThreshold = ema_squeeze ? 0.6 : 0.7;
  
  return {
    volume_ok: volumeRatio >= volumeThreshold,
    volatility_ok: volRatio >= 0.001 && volRatio <= 0.03, // Relaxed lower bound
    volume_ratio: volumeRatio,
    vol_ratio: volRatio,
    ema_squeeze,
  };
}

// ============================================================================
// TREND DETECTION (SIMPLIFIED - NO HTF)
// ============================================================================

export interface TrendState {
  long_active: boolean;
  short_active: boolean;
  ema8_5m: number;
  ema21_5m: number;
  ema8_prev: number;
  close_5m: number;
}

/**
 * Determine DAYTRADER v3 trend (5m only, no 15m HTF)
 * 
 * LONG TREND: EMA8_5m > EMA21_5m
 * SHORT TREND: EMA8_5m < EMA21_5m
 */
export function getDaytraderTrendV3(bars5m: OHLCBar[]): TrendState {
  if (bars5m.length < 21) {
    return {
      long_active: false,
      short_active: false,
      ema8_5m: 0,
      ema21_5m: 0,
      ema8_prev: 0,
      close_5m: 0,
    };
  }
  
  const closes5m = bars5m.map(b => b.close);
  
  const ema8_5m = calculateEMA(closes5m, 8);
  const ema21_5m = calculateEMA(closes5m, 21);
  
  // Calculate previous EMA8 for slope detection
  const prevCloses = closes5m.slice(0, -1);
  const ema8_prev = calculateEMA(prevCloses, 8);
  
  const close_5m = closes5m[closes5m.length - 1];
  
  const long_active = ema8_5m > ema21_5m;
  const short_active = ema8_5m < ema21_5m;
  
  return {
    long_active,
    short_active,
    ema8_5m,
    ema21_5m,
    ema8_prev,
    close_5m,
  };
}

// ============================================================================
// SETUP TYPE A: MICRO-BREAKOUT (NEW)
// ============================================================================

export interface MicroBreakoutSetup {
  is_valid: boolean;
  direction: 'long' | 'short' | 'none';
  entry_price: number | null;
  reason: string;
}

/**
 * Detect MICRO-BREAKOUT setup (NEW in v3)
 * 
 * LONG: Trend active, breaks previous candle high, EMA8 slope positive
 * SHORT: Trend active, breaks previous candle low, EMA8 slope negative
 * 
 * This should add +15 to +40 trades per month
 */
export function checkMicroBreakout(
  bars5m: OHLCBar[],
  trend: TrendState,
  filters: MarketFilters
): MicroBreakoutSetup {
  if (bars5m.length < 21) {
    return {
      is_valid: false,
      direction: 'none',
      entry_price: null,
      reason: 'Insufficient bars for micro-breakout',
    };
  }
  
  if (!filters.volume_ok || !filters.volatility_ok) {
    return {
      is_valid: false,
      direction: 'none',
      entry_price: null,
      reason: 'Market filters failed',
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const prevBar = bars5m[bars5m.length - 2];
  
  // Check EMA8 slope
  const ema8_slope_positive = trend.ema8_5m > trend.ema8_prev;
  const ema8_slope_negative = trend.ema8_5m < trend.ema8_prev;
  
  // LONG: break previous high with positive EMA8 slope
  if (trend.long_active && currentBar.high > prevBar.high && ema8_slope_positive) {
    return {
      is_valid: true,
      direction: 'long',
      entry_price: currentBar.high, // Entry at break of previous high
      reason: `Micro-breakout LONG: broke ${prevBar.high.toFixed(2)}, EMA8 slope +${((trend.ema8_5m - trend.ema8_prev) / trend.ema8_prev * 100).toFixed(2)}%`,
    };
  }
  
  // SHORT: break previous low with negative EMA8 slope
  if (trend.short_active && currentBar.low < prevBar.low && ema8_slope_negative) {
    return {
      is_valid: true,
      direction: 'short',
      entry_price: currentBar.low, // Entry at break of previous low
      reason: `Micro-breakout SHORT: broke ${prevBar.low.toFixed(2)}, EMA8 slope ${((trend.ema8_5m - trend.ema8_prev) / trend.ema8_prev * 100).toFixed(2)}%`,
    };
  }
  
  return {
    is_valid: false,
    direction: 'none',
    entry_price: null,
    reason: 'No micro-breakout pattern',
  };
}

// ============================================================================
// SETUP TYPE B: BREAKOUT CONTINUATION V3 (LOOSER)
// ============================================================================

export interface BreakoutSetup {
  is_valid: boolean;
  direction: 'long' | 'short' | 'none';
  consolidation_tight: boolean;
  close_strength: boolean;
  reason: string;
}

/**
 * Detect BREAKOUT CONTINUATION v3 (LOOSER)
 * 
 * LONG: consolidation window (5-8 bars), range <= 2.0x ATR (was 1.5x),
 *       close > window_high, close in top 40%, volume >= 0.7x (no spike required)
 * 
 * SHORT: mirror
 */
export function checkBreakoutContinuationV3(
  bars5m: OHLCBar[],
  trend: TrendState,
  filters: MarketFilters
): BreakoutSetup {
  const windowSize = 6; // 5-8 candles
  
  if (bars5m.length < 21 + windowSize) {
    return {
      is_valid: false,
      direction: 'none',
      consolidation_tight: false,
      close_strength: false,
      reason: 'Insufficient bars for breakout v3',
    };
  }
  
  if (!filters.volume_ok || !filters.volatility_ok) {
    return {
      is_valid: false,
      direction: 'none',
      consolidation_tight: false,
      close_strength: false,
      reason: 'Market filters failed',
    };
  }
  
  const currentBar = bars5m[bars5m.length - 1];
  const windowBars = bars5m.slice(-windowSize - 1, -1);
  
  const atr = calculateATR(bars5m, 14);
  
  // Check consolidation tightness (looser: 2.0x ATR)
  const highs = windowBars.map(b => b.high);
  const lows = windowBars.map(b => b.low);
  const windowHigh = Math.max(...highs);
  const windowLow = Math.min(...lows);
  const range = windowHigh - windowLow;
  const consolidation_tight = range <= 2.0 * atr;
  
  // Check close strength (top/bottom 40%)
  const barRange = currentBar.high - currentBar.low;
  const closePosition = barRange > 0 
    ? (currentBar.close - currentBar.low) / barRange 
    : 0.5;
  
  // LONG breakout
  if (trend.long_active && consolidation_tight) {
    const broke_above = currentBar.close > windowHigh;
    const close_strength = closePosition >= 0.6; // top 40%
    
    if (broke_above && close_strength) {
      return {
        is_valid: true,
        direction: 'long',
        consolidation_tight: true,
        close_strength: true,
        reason: `Breakout v3 LONG: above ${windowHigh.toFixed(2)}, range ${(range / atr).toFixed(1)}x ATR, close ${(closePosition * 100).toFixed(0)}%`,
      };
    }
  }
  
  // SHORT breakout
  if (trend.short_active && consolidation_tight) {
    const broke_below = currentBar.close < windowLow;
    const close_strength = closePosition <= 0.4; // bottom 40%
    
    if (broke_below && close_strength) {
      return {
        is_valid: true,
        direction: 'short',
        consolidation_tight: true,
        close_strength: true,
        reason: `Breakout v3 SHORT: below ${windowLow.toFixed(2)}, range ${(range / atr).toFixed(1)}x ATR, close ${(closePosition * 100).toFixed(0)}%`,
      };
    }
  }
  
  return {
    is_valid: false,
    direction: 'none',
    consolidation_tight,
    close_strength: false,
    reason: 'No breakout v3 confirmation',
  };
}

// ============================================================================
// SETUP TYPE C: PULLBACK CONTINUATION V3 (SIMPLIFIED)
// ============================================================================

export interface PullbackSetup {
  is_valid: boolean;
  direction: 'long' | 'short' | 'none';
  touched_ema21: boolean;
  close_above_ema8: boolean;
  entry_trigger_price: number | null;
  reason: string;
}

/**
 * Detect PULLBACK CONTINUATION v3 (SIMPLIFIED)
 * 
 * LONG: price touched EMA21 in last 1-2 candles, current close > EMA8
 *       Entry: next candle breaks current high
 * 
 * SHORT: mirror
 * 
 * Removed wick requirements from v2
 */
export function checkPullbackContinuationV3(
  bars5m: OHLCBar[],
  trend: TrendState,
  filters: MarketFilters
): PullbackSetup {
  if (bars5m.length < 21) {
    return {
      is_valid: false,
      direction: 'none',
      touched_ema21: false,
      close_above_ema8: false,
      entry_trigger_price: null,
      reason: 'Insufficient bars for pullback v3',
    };
  }
  
  if (!filters.volume_ok || !filters.volatility_ok) {
    return {
      is_valid: false,
      direction: 'none',
      touched_ema21: false,
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
  
  // LONG pullback (simplified: no wick requirements)
  if (trend.long_active && touched_ema21) {
    const close_above_ema8 = currentBar.close > trend.ema8_5m;
    
    if (close_above_ema8) {
      return {
        is_valid: true,
        direction: 'long',
        touched_ema21: true,
        close_above_ema8: true,
        entry_trigger_price: currentBar.high, // Entry on break of current high
        reason: `Pullback v3 LONG: touched EMA21 (${trend.ema21_5m.toFixed(2)}), close above EMA8 (${trend.ema8_5m.toFixed(2)})`,
      };
    }
  }
  
  // SHORT pullback (simplified: no wick requirements)
  if (trend.short_active && (currentBar.high >= trend.ema21_5m || (prevBar && prevBar.high >= trend.ema21_5m))) {
    const close_below_ema8 = currentBar.close < trend.ema8_5m;
    
    if (close_below_ema8) {
      return {
        is_valid: true,
        direction: 'short',
        touched_ema21: true,
        close_above_ema8: false,
        entry_trigger_price: currentBar.low, // Entry on break of current low
        reason: `Pullback v3 SHORT: touched EMA21 (${trend.ema21_5m.toFixed(2)}), close below EMA8 (${trend.ema8_5m.toFixed(2)})`,
      };
    }
  }
  
  return {
    is_valid: false,
    direction: 'none',
    touched_ema21,
    close_above_ema8: false,
    entry_trigger_price: null,
    reason: 'No pullback v3 pattern',
  };
}

// ============================================================================
// UNIFIED ENTRY EVALUATION V3
// ============================================================================

export interface DaytraderEntrySignalV3 {
  should_enter: boolean;
  direction: 'long' | 'short' | 'none';
  setup_type: 'micro-breakout' | 'breakout' | 'pullback' | 'none';
  entry_price: number | null;
  reason: string;
  trend: TrendState;
  filters: MarketFilters;
}

/**
 * Evaluate DAYTRADER v3 entry for 5m candles
 * Checks THREE setup types: micro-breakout, breakout, pullback
 * NO 15m HTF confirmation needed
 */
export function evaluateDaytraderEntryV3(bars5m: OHLCBar[]): DaytraderEntrySignalV3 {
  // Check trend
  const trend = getDaytraderTrendV3(bars5m);
  
  if (!trend.long_active && !trend.short_active) {
    return {
      should_enter: false,
      direction: 'none',
      setup_type: 'none',
      entry_price: null,
      reason: 'No clear trend (EMA8/21 alignment)',
      trend,
      filters: checkDaytraderMarketFiltersV3(bars5m, trend.ema8_5m, trend.ema21_5m),
    };
  }
  
  // Check market filters
  const filters = checkDaytraderMarketFiltersV3(bars5m, trend.ema8_5m, trend.ema21_5m);
  
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
  
  // Priority 1: Micro-breakout (NEW - highest frequency)
  const microBreakout = checkMicroBreakout(bars5m, trend, filters);
  if (microBreakout.is_valid) {
    return {
      should_enter: true,
      direction: microBreakout.direction,
      setup_type: 'micro-breakout',
      entry_price: microBreakout.entry_price,
      reason: `MICRO-BREAKOUT: ${microBreakout.reason}${filters.ema_squeeze ? ' [EMA SQUEEZE]' : ''}`,
      trend,
      filters,
    };
  }
  
  // Priority 2: Breakout continuation v3
  const breakout = checkBreakoutContinuationV3(bars5m, trend, filters);
  if (breakout.is_valid) {
    return {
      should_enter: true,
      direction: breakout.direction,
      setup_type: 'breakout',
      entry_price: bars5m[bars5m.length - 1].close,
      reason: `BREAKOUT v3: ${breakout.reason}${filters.ema_squeeze ? ' [EMA SQUEEZE]' : ''}`,
      trend,
      filters,
    };
  }
  
  // Priority 3: Pullback continuation v3
  const pullback = checkPullbackContinuationV3(bars5m, trend, filters);
  if (pullback.is_valid) {
    return {
      should_enter: true,
      direction: pullback.direction,
      setup_type: 'pullback',
      entry_price: pullback.entry_trigger_price,
      reason: `PULLBACK v3: ${pullback.reason}${filters.ema_squeeze ? ' [EMA SQUEEZE]' : ''}`,
      trend,
      filters,
    };
  }
  
  return {
    should_enter: false,
    direction: 'none',
    setup_type: 'none',
    entry_price: null,
    reason: 'No valid v3 setup (micro-breakout, breakout, or pullback)',
    trend,
    filters,
  };
}
