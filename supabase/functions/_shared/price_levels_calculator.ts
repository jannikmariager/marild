/**
 * Engine-Specific Price Levels Calculator
 * 
 * Calculates Stop Loss (SL) and Take Profit (TP) levels using ATR-based risk units (R)
 * with engine-specific multipliers and position management rules.
 * 
 * ALL CALCULATIONS ARE PRO GATED
 * 
 * Rules:
 * - DAYTRADER: R = 0.5×ATR, TP1=1R, TP2=2R (tight stops, quick wins)
 * - SWING: R = 1.0×ATR, TP1=2R, TP2=3.5R (balanced risk/reward)
 * - INVESTOR: R = 2.0×ATR, TP1=2R, TP2=4R (wide stops, patient)
 * 
 * All executions on candle close, no intrabar lookahead.
 */

import { OHLCBar, EngineType } from './signal_types.ts';
export type { OHLCBar } from './signal_types.ts';

export interface PriceLevels {
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  r_value: number; // Risk unit in price terms
  atr_value: number; // ATR for reference
  r_multiple: number; // R multiple for this engine (0.5, 1.0, or 2.0)
}

export interface PositionManagementRule {
  tp1_close_pct: number; // % to close at TP1
  tp2_close_pct: number; // % to close at TP2
  move_sl_to_breakeven_after_tp1: boolean;
}

// ============================================================
// ATR CALCULATION
// ============================================================

/**
 * Calculate Average True Range (ATR) from OHLCV data
 * 
 * @param bars - Array of OHLCV bars (must be at least period+1 length)
 * @param period - ATR period (default 14)
 * @returns ATR value
 */
export function calculateATR(bars: OHLCBar[], period: number = 14): number {
  if (bars.length < period + 1) {
    throw new Error(`Insufficient data for ATR calculation. Need ${period + 1} bars, got ${bars.length}`);
  }

  // Calculate True Range for each bar
  const trueRanges: number[] = [];
  
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    
    // True Range = max(high-low, |high-prevClose|, |low-prevClose|)
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }

  // Calculate ATR as simple moving average of TR
  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;
  
  return atr;
}

/**
 * Aggregate hourly bars into 15-minute OHLC candles
 * Used for DAYTRADER ATR calculation
 */
function aggregateTo15MinBars(hourlyBars: OHLCBar[]): OHLCBar[] {
  // For simplification: take every 4th hourly bar as a proxy for 15m resolution
  // In production, true 15m bars would be fetched from DB
  // This is a conservative approximation
  const bars15m: OHLCBar[] = [];
  
  for (let i = 0; i < hourlyBars.length; i += 4) {
    const slice = hourlyBars.slice(i, Math.min(i + 4, hourlyBars.length));
    if (slice.length === 0) continue;
    
    const open = slice[0].open;
    const close = slice[slice.length - 1].close;
    const high = Math.max(...slice.map(b => b.high));
    const low = Math.min(...slice.map(b => b.low));
    const volume = slice.reduce((sum, b) => sum + b.volume, 0);
    const timestamp = slice[0].timestamp;
    
    bars15m.push({ timestamp, open, high, low, close, volume });
  }
  
  return bars15m;
}

/**
 * Calculate stabilized ATR for DAYTRADER using 15m and 1h candles
 * Returns max(ATR_15m, ATR_1h) to ensure R is never microscopic
 */
function calculateDaytraderATR(hourlyBars: OHLCBar[]): number {
  if (hourlyBars.length < 50) {
    // Fallback to standard ATR if insufficient data
    return calculateATR(hourlyBars, 14);
  }
  
  // Compute ATR on 1h candles
  const atr1h = calculateATR(hourlyBars, 14);
  
  // Compute ATR on aggregated 15m candles
  const bars15m = aggregateTo15MinBars(hourlyBars);
  let atr15m = atr1h; // Default to 1h if 15m has insufficient data
  
  if (bars15m.length >= 15) {
    atr15m = calculateATR(bars15m, 14);
  }
  
  // Return the larger of the two to stabilize R
  const baseATR = Math.max(atr15m, atr1h);
  
  return baseATR;
}

// ============================================================
// ENGINE-SPECIFIC POSITION MANAGEMENT RULES
// ============================================================

export function getPositionManagementRule(engine: EngineType): PositionManagementRule {
  switch (engine) {
    case 'DAYTRADER':
      return {
        tp1_close_pct: 50, // Close 50% at TP1
        tp2_close_pct: 50, // Close remaining 50% at TP2
        move_sl_to_breakeven_after_tp1: true,
      };
    
    case 'SWING':
      return {
        tp1_close_pct: 50, // Close 50% at TP1
        tp2_close_pct: 50, // Close remaining 50% at TP2
        move_sl_to_breakeven_after_tp1: true,
      };
    
    case 'INVESTOR':
      return {
        tp1_close_pct: 40, // Close 40% at TP1
        tp2_close_pct: 60, // Close remaining 60% at TP2
        move_sl_to_breakeven_after_tp1: true,
      };
    
    default:
      // Default to SWING
      return {
        tp1_close_pct: 50,
        tp2_close_pct: 50,
        move_sl_to_breakeven_after_tp1: true,
      };
  }
}

// ============================================================
// DAYTRADER PRICE LEVELS (STABILIZED R)
// ============================================================

function calculateDaytraderLevels(
  entryPrice: number,
  atr: number,
  direction: 'long' | 'short',
  hourlyBars?: OHLCBar[]
): PriceLevels {
  // For DAYTRADER backtest: use stabilized ATR from 15m/1h
  let baseATR = atr;
  if (hourlyBars && hourlyBars.length >= 50) {
    baseATR = calculateDaytraderATR(hourlyBars);
  }
  
  // Apply minimum R floor: 0.2% of entry price
  const minimumR = 0.002 * entryPrice;
  
  // R = max(0.5 × baseATR, minimumR)
  const rMultiple = 0.5;
  const R = Math.max(rMultiple * baseATR, minimumR);
  
  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  
  if (direction === 'long') {
    // LONG: SL below, TPs above
    stopLoss = entryPrice - R;
    tp1 = entryPrice + (1.0 * R); // +1R
    tp2 = entryPrice + (2.0 * R); // +2R
  } else {
    // SHORT: SL above, TPs below
    stopLoss = entryPrice + R;
    tp1 = entryPrice - (1.0 * R); // -1R
    tp2 = entryPrice - (2.0 * R); // -2R
  }
  
  return {
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit_1: tp1,
    take_profit_2: tp2,
    r_value: R,
    atr_value: baseATR,
    r_multiple: rMultiple,
  };
}

// ============================================================
// SWING PRICE LEVELS
// ============================================================

function calculateSwingLevels(
  entryPrice: number,
  atr: number,
  direction: 'long' | 'short'
): PriceLevels {
  // R = 1.0 × ATR (standard stop)
  const rMultiple = 1.0;
  const R = atr * rMultiple;
  
  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  
  if (direction === 'long') {
    stopLoss = entryPrice - R;
    tp1 = entryPrice + (2.0 * R); // +2R
    tp2 = entryPrice + (3.5 * R); // +3.5R
  } else {
    stopLoss = entryPrice + R;
    tp1 = entryPrice - (2.0 * R); // -2R
    tp2 = entryPrice - (3.5 * R); // -3.5R
  }
  
  return {
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit_1: tp1,
    take_profit_2: tp2,
    r_value: R,
    atr_value: atr,
    r_multiple: rMultiple,
  };
}

// ============================================================
// INVESTOR PRICE LEVELS
// ============================================================

function calculateInvestorLevels(
  entryPrice: number,
  atr: number,
  direction: 'long' | 'short'
): PriceLevels {
  // R = 2.0 × ATR (wide stop for long-term positions)
  const rMultiple = 2.0;
  const R = atr * rMultiple;
  
  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  
  if (direction === 'long') {
    stopLoss = entryPrice - R;
    tp1 = entryPrice + (2.0 * R); // +2R (medium-term gain)
    tp2 = entryPrice + (4.0 * R); // +4R (long-term gain)
  } else {
    stopLoss = entryPrice + R;
    tp1 = entryPrice - (2.0 * R); // -2R
    tp2 = entryPrice - (4.0 * R); // -4R
  }
  
  return {
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit_1: tp1,
    take_profit_2: tp2,
    r_value: R,
    atr_value: atr,
    r_multiple: rMultiple,
  };
}

// ============================================================
// MAIN PRICE LEVELS CALCULATOR
// ============================================================

/**
 * Calculate price levels (Entry, SL, TP1, TP2) based on engine type
 * 
 * @param engine - Trading engine type
 * @param entryPrice - Entry price
 * @param bars - OHLCV bars for ATR calculation (minimum 15 bars)
 * @param direction - Trade direction ('long' or 'short')
 * @param signalType - Signal type for direction inference (fallback)
 * @returns PriceLevels object with all price levels
 */
export function calculatePriceLevelsByEngine(
  engine: EngineType,
  entryPrice: number,
  bars: OHLCBar[],
  direction?: 'long' | 'short',
  signalType?: 'buy' | 'sell' | 'neutral'
): PriceLevels {
  // Infer direction from signalType if not provided
  if (!direction && signalType) {
    if (signalType === 'buy') {
      direction = 'long';
    } else if (signalType === 'sell') {
      direction = 'short';
    } else {
      // Neutral signal - default to long for price level calculation
      direction = 'long';
    }
  }
  
  if (!direction) {
    throw new Error('Direction must be provided or inferable from signalType');
  }
  
  // Calculate ATR from bars
  const atr = calculateATR(bars);
  
  // Calculate engine-specific levels
  switch (engine) {
    case 'DAYTRADER':
      // Pass bars to DAYTRADER for stabilized ATR calculation
      return calculateDaytraderLevels(entryPrice, atr, direction, bars);
    
    case 'SWING':
      return calculateSwingLevels(entryPrice, atr, direction);
    
    case 'INVESTOR':
      return calculateInvestorLevels(entryPrice, atr, direction);
    
    default:
      // Default to SWING
      console.warn(`Unknown engine type: ${engine}, defaulting to SWING`);
      return calculateSwingLevels(entryPrice, atr, direction);
  }
}

// ============================================================
// POSITION SIZING HELPERS
// ============================================================

/**
 * Calculate position size based on risk percentage and R value
 * 
 * @param accountEquity - Current account equity
 * @param riskPercentage - Risk per trade as percentage (e.g. 1.0 for 1%)
 * @param rValue - Risk unit in price terms
 * @param entryPrice - Entry price per unit
 * @returns Position size in units
 */
export function calculatePositionSize(
  accountEquity: number,
  riskPercentage: number,
  rValue: number,
  entryPrice: number
): number {
  // Risk capital = account equity × risk percentage
  const riskCapital = accountEquity * (riskPercentage / 100);
  
  // Position size = risk capital / R value
  // This ensures that if SL is hit, loss = riskCapital
  const positionSize = riskCapital / rValue;
  
  return positionSize;
}

/**
 * Get recommended risk percentage per trade for each engine
 */
export function getRecommendedRiskPercentage(engine: EngineType): number {
  switch (engine) {
    case 'DAYTRADER':
      return 1.0; // 1% per trade (backtest)
    case 'SWING':
      return 1.5; // 1.5% per trade (backtest)
    case 'INVESTOR':
      return 2.0; // 2% per trade (backtest)
    default:
      return 1.5; // Default to SWING
  }
}

/**
 * Get maximum concurrent positions for each engine
 */
export function getMaxConcurrentPositions(engine: EngineType): number {
  switch (engine) {
    case 'DAYTRADER':
      return 4;
    case 'SWING':
      return 3;
    case 'INVESTOR':
      return 2;
    default:
      return 3;
  }
}
