/**
 * Technical Indicators for Backtest Engine
 * Pure price/volume calculations - NO OpenAI
 */

import { OHLCBar } from "./types";

/**
 * Calculate Exponential Moving Average (EMA)
 * @param prices Array of prices (typically close prices)
 * @param period EMA period (e.g. 50, 100)
 * @returns Array of EMA values (first `period-1` values are null)
 */
export function calculateEMA(prices: number[], period: number): (number | null)[] {
  if (prices.length < period) {
    return prices.map(() => null);
  }

  const multiplier = 2 / (period + 1);
  const ema: (number | null)[] = [];

  // First EMA is SMA
  const sma = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  
  for (let i = 0; i < period - 1; i++) {
    ema.push(null);
  }
  ema.push(sma);

  // Calculate remaining EMA values
  for (let i = period; i < prices.length; i++) {
    const prevEMA = ema[i - 1]!;
    const currentEMA = (prices[i] - prevEMA) * multiplier + prevEMA;
    ema.push(currentEMA);
  }

  return ema;
}

/**
 * Calculate Average True Range (ATR)
 * Measures volatility
 * @param bars OHLC bars
 * @param period ATR period (typically 14)
 * @returns Array of ATR values
 */
export function calculateATR(bars: OHLCBar[], period: number): (number | null)[] {
  if (bars.length < period + 1) {
    return bars.map(() => null);
  }

  const trueRanges: number[] = [];
  
  // Calculate True Range for each bar
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }

  // First ATR is simple average
  const atr: (number | null)[] = [null]; // First bar has no TR
  const firstATR = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
  
  for (let i = 1; i < period; i++) {
    atr.push(null);
  }
  atr.push(firstATR);

  // Subsequent ATRs use smoothing
  const multiplier = 1 / period;
  for (let i = period; i < trueRanges.length; i++) {
    const prevATR = atr[i]!;
    const currentATR = prevATR * (1 - multiplier) + trueRanges[i] * multiplier;
    atr.push(currentATR);
  }

  return atr;
}

/**
 * Calculate average volume over a period
 * @param bars OHLC bars
 * @param period Volume average period
 * @returns Array of average volumes
 */
export function calculateAverageVolume(bars: OHLCBar[], period: number): (number | null)[] {
  if (bars.length < period) {
    return bars.map(() => null);
  }

  const avgVolumes: (number | null)[] = [];

  for (let i = 0; i < period - 1; i++) {
    avgVolumes.push(null);
  }

  for (let i = period - 1; i < bars.length; i++) {
    const windowVolumes = bars.slice(i - period + 1, i + 1).map(b => b.volume);
    const avg = windowVolumes.reduce((sum, vol) => sum + vol, 0) / period;
    avgVolumes.push(avg);
  }

  return avgVolumes;
}

/**
 * Find swing highs and lows (simple implementation)
 * A swing high is a high that is higher than N bars before and after
 * A swing low is a low that is lower than N bars before and after
 * @param bars OHLC bars
 * @param lookback Number of bars to look before/after
 * @returns Object with swing highs and lows indices
 */
export function findSwingPoints(
  bars: OHLCBar[],
  lookback: number = 5
): { swingHighs: number[]; swingLows: number[] } {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    const high = bars[i].high;
    const low = bars[i].low;

    // Check if this is a swing high
    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && bars[j].high >= high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) {
      swingHighs.push(i);
    }

    // Check if this is a swing low
    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && bars[j].low <= low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) {
      swingLows.push(i);
    }
  }

  return { swingHighs, swingLows };
}

/**
 * Calculate relative volume (current volume / average volume)
 * @param currentVolume Current bar's volume
 * @param avgVolume Average volume
 * @returns Relative volume ratio
 */
export function calculateRelativeVolume(currentVolume: number, avgVolume: number): number {
  if (avgVolume === 0) return 1;
  return currentVolume / avgVolume;
}

/**
 * Determine trend direction based on EMAs
 * @param price Current price
 * @param ema50 50-period EMA
 * @param ema100 100-period EMA
 * @returns "uptrend" | "downtrend" | "sideways"
 */
export function determineTrend(
  price: number,
  ema50: number | null,
  ema100: number | null
): "uptrend" | "downtrend" | "sideways" {
  if (ema50 === null || ema100 === null) {
    return "sideways";
  }

  if (price > ema50 && ema50 > ema100) {
    return "uptrend";
  } else if (price < ema50 && ema50 < ema100) {
    return "downtrend";
  }

  return "sideways";
}

/**
 * Check if price is near a level (within tolerance)
 * @param price Current price
 * @param level Target level
 * @param tolerance Percentage tolerance (e.g. 0.02 for 2%)
 * @returns True if price is within tolerance of level
 */
export function isPriceNearLevel(price: number, level: number, tolerance: number = 0.02): boolean {
  const diff = Math.abs(price - level) / level;
  return diff <= tolerance;
}
