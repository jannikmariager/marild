/**
 * Backtest Entry Rules
 * 
 * DETERMINISTIC rules for backtesting. These are SEPARATE from live AI evaluation
 * and use simple, reproducible technical indicators to generate entry signals.
 * 
 * ALL BACKTEST LOGIC IS PRO GATED
 * 
 * Rules per engine:
 * - DAYTRADER: Light rules (EMA20, volume ≥0.6×avg)
 * - SWING: Balanced rules (EMA20/50 cross, volume ≥0.8×avg)
 * - INVESTOR: Strict rules (EMA50/200 cross, fundamentals check, low volatility)
 * 
 * All calculations on CANDLE CLOSE, no intrabar lookahead.
 */

import { OHLCBar, EngineType, FundamentalsData } from './signal_types.ts';

export interface EntrySignal {
  should_enter: boolean;
  direction: 'long' | 'short' | 'none';
  reason: string;
}

// ============================================================
// TECHNICAL INDICATORS
// ============================================================

/**
 * Calculate Exponential Moving Average (EMA)
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Insufficient data for EMA${period}. Need ${period} bars, got ${prices.length}`);
  }
  
  const k = 2 / (period + 1); // Smoothing factor
  
  // Start with SMA for initial value
  const sma = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  
  // Calculate EMA iteratively
  let ema = sma;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

/**
 * Calculate Average Volume
 */
function calculateAvgVolume(bars: OHLCBar[], period: number = 20): number {
  if (bars.length < period) {
    throw new Error(`Insufficient data for avg volume. Need ${period} bars, got ${bars.length}`);
  }
  
  const recentBars = bars.slice(-period);
  const totalVolume = recentBars.reduce((sum, bar) => sum + bar.volume, 0);
  return totalVolume / period;
}

/**
 * Calculate volatility (standard deviation of returns)
 */
function calculateVolatility(prices: number[], period: number = 20): number {
  if (prices.length < period + 1) {
    throw new Error(`Insufficient data for volatility. Need ${period + 1} bars, got ${prices.length}`);
  }
  
  // Calculate returns
  const returns: number[] = [];
  for (let i = prices.length - period; i < prices.length; i++) {
    const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(ret);
  }
  
  // Calculate standard deviation
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  return stdDev;
}

// ============================================================
// DAYTRADER ENTRY RULES (PHASE 2 - v2 MOMENTUM STRATEGY)
// ============================================================

/**
 * DAYTRADER Entry Rules v2 (Phase 2)
 * 
 * Uses new EMA8/21 momentum strategy with breakout/pullback setups.
 * For daily-aggregated bars (production backtest), we adapt the logic
 * to work with available data, but the primary implementation is in
 * daytrader_entry_v2.ts for 5m/15m intraday candles.
 * 
 * This function is kept for backward compatibility with existing
 * production backtest code that may still call it with daily bars.
 */
export function evaluateDaytraderEntry(bars: OHLCBar[]): EntrySignal {
  if (bars.length < 21) {
    return {
      should_enter: false,
      direction: 'none',
      reason: 'Insufficient data for DAYTRADER v2 entry rules',
    };
  }
  
  const closePrices = bars.map(b => b.close);
  const currentPrice = closePrices[closePrices.length - 1];
  const currentBar = bars[bars.length - 1];
  
  // Calculate EMAs (v2 uses EMA8 and EMA21)
  const ema8 = calculateEMA(closePrices, 8);
  const ema21 = calculateEMA(closePrices, 21);
  
  // Calculate average volume (relaxed to 0.7x)
  const avgVolume = calculateAvgVolume(bars, 20);
  const volumeRatio = currentBar.volume / avgVolume;
  
  if (volumeRatio < 0.7) {
    return {
      should_enter: false,
      direction: 'none',
      reason: `Volume too low (${(volumeRatio * 100).toFixed(0)}% of avg, need ≥70%)`,
    };
  }
  
  // Volatility filter: 0.2%-3% (relaxed from <5%)
  const atr = bars.length > 14 ? calculateATR(bars, 14) : 0;
  const volRatio = atr / currentPrice;
  if (volRatio < 0.002 || volRatio > 0.03) {
    return {
      should_enter: false,
      direction: 'none',
      reason: `Volatility extreme (${(volRatio * 100).toFixed(1)}%, need 0.2-3%)`,
    };
  }
  
  // Simple trend check: EMA8 vs EMA21 and price alignment
  const longTrend = ema8 > ema21 && currentPrice > ema21;
  const shortTrend = ema8 < ema21 && currentPrice < ema21;
  
  if (!longTrend && !shortTrend) {
    return {
      should_enter: false,
      direction: 'none',
      reason: 'No clear trend (EMA8/21 alignment)',
    };
  }
  
  // Simplified momentum check (for daily bars, less granular than intraday)
  const priceChange3Bars = bars.length > 3 
    ? (currentPrice - closePrices[closePrices.length - 4]) / closePrices[closePrices.length - 4]
    : 0;
  
  // LONG: trend + momentum
  if (longTrend && priceChange3Bars > 0.005) {
    return {
      should_enter: true,
      direction: 'long',
      reason: `Uptrend (EMA8: ${ema8.toFixed(2)} > EMA21: ${ema21.toFixed(2)}), volume ${(volumeRatio * 100).toFixed(0)}%, momentum +${(priceChange3Bars * 100).toFixed(1)}%`,
    };
  }
  
  // SHORT: trend + momentum
  if (shortTrend && priceChange3Bars < -0.005) {
    return {
      should_enter: true,
      direction: 'short',
      reason: `Downtrend (EMA8: ${ema8.toFixed(2)} < EMA21: ${ema21.toFixed(2)}), volume ${(volumeRatio * 100).toFixed(0)}%, momentum ${(priceChange3Bars * 100).toFixed(1)}%`,
    };
  }
  
  return {
    should_enter: false,
    direction: 'none',
    reason: 'Trend present but insufficient momentum',
  };
}

/**
 * Helper: Calculate ATR
 */
function calculateATR(bars: OHLCBar[], period: number): number {
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

// ============================================================
// SWING ENTRY RULES
// ============================================================

/**
 * SWING Entry Rules: Balanced
 * - EMA20/50 alignment for trend
 * - Volume ≥ 0.8× average (moderate volume requirement)
 * - Price near but not overextended from EMA20
 */
export function evaluateSwingEntry(bars: OHLCBar[]): EntrySignal {
  if (bars.length < 55) {
    return {
      should_enter: false,
      direction: 'none',
      reason: 'Insufficient data for SWING entry rules',
    };
  }
  
  const closePrices = bars.map(b => b.close);
  const currentPrice = closePrices[closePrices.length - 1];
  const currentVolume = bars[bars.length - 1].volume;
  
  // Calculate EMAs
  const ema20 = calculateEMA(closePrices, 20);
  const ema50 = calculateEMA(closePrices, 50);
  
  // Calculate average volume
  const avgVolume = calculateAvgVolume(bars, 20);
  
  // Volume check (minimum 0.8× average)
  const volumeRatio = currentVolume / avgVolume;
  if (volumeRatio < 0.8) {
    return {
      should_enter: false,
      direction: 'none',
      reason: `Volume too low (${(volumeRatio * 100).toFixed(0)}% of avg)`,
    };
  }
  
  // Distance from EMA20 (avoid overextension)
  const distanceFromEma20Pct = ((currentPrice - ema20) / ema20) * 100;
  const maxDistancePct = 3.0; // Max 3% from EMA20
  
  if (Math.abs(distanceFromEma20Pct) > maxDistancePct) {
    return {
      should_enter: false,
      direction: 'none',
      reason: `Price too far from EMA20 (${distanceFromEma20Pct.toFixed(1)}%)`,
    };
  }
  
  // LONG: EMA20 > EMA50 (uptrend) + price above EMA20
  if (ema20 > ema50 && currentPrice > ema20) {
    return {
      should_enter: true,
      direction: 'long',
      reason: `Uptrend confirmed (EMA20: ${ema20.toFixed(2)} > EMA50: ${ema50.toFixed(2)}), price ${distanceFromEma20Pct.toFixed(1)}% above EMA20, volume ${(volumeRatio * 100).toFixed(0)}% of avg`,
    };
  }
  
  // SHORT: EMA20 < EMA50 (downtrend) + price below EMA20
  if (ema20 < ema50 && currentPrice < ema20) {
    return {
      should_enter: true,
      direction: 'short',
      reason: `Downtrend confirmed (EMA20: ${ema20.toFixed(2)} < EMA50: ${ema50.toFixed(2)}), price ${Math.abs(distanceFromEma20Pct).toFixed(1)}% below EMA20, volume ${(volumeRatio * 100).toFixed(0)}% of avg`,
    };
  }
  
  return {
    should_enter: false,
    direction: 'none',
    reason: 'No clear EMA alignment or price position',
  };
}

// ============================================================
// INVESTOR ENTRY RULES
// ============================================================

/**
 * INVESTOR Entry Rules: Strict & Macro-Focused
 * - EMA50/200 alignment (long-term trend)
 * - Low volatility (<2% daily)
 * - Strong fundamentals (if available)
 * - Volume ≥ 1.0× average (require normal or elevated volume)
 */
export function evaluateInvestorEntry(
  bars: OHLCBar[],
  fundamentals?: FundamentalsData
): EntrySignal {
  if (bars.length < 205) {
    return {
      should_enter: false,
      direction: 'none',
      reason: 'Insufficient data for INVESTOR entry rules',
    };
  }
  
  const closePrices = bars.map(b => b.close);
  const currentPrice = closePrices[closePrices.length - 1];
  const currentVolume = bars[bars.length - 1].volume;
  
  // Calculate EMAs
  const ema50 = calculateEMA(closePrices, 50);
  const ema200 = calculateEMA(closePrices, 200);
  
  // Calculate average volume
  const avgVolume = calculateAvgVolume(bars, 20);
  
  // Volume check (minimum 1.0× average)
  const volumeRatio = currentVolume / avgVolume;
  if (volumeRatio < 1.0) {
    return {
      should_enter: false,
      direction: 'none',
      reason: `Volume too low (${(volumeRatio * 100).toFixed(0)}% of avg)`,
    };
  }
  
  // Volatility check (require low volatility for long-term entries)
  const volatility = calculateVolatility(closePrices, 20);
  const volatilityPct = volatility * 100;
  if (volatilityPct > 2.0) {
    return {
      should_enter: false,
      direction: 'none',
      reason: `Volatility too high (${volatilityPct.toFixed(2)}% daily)`,
    };
  }
  
  // Fundamentals check (if available)
  let fundamentalsPass = true;
  let fundamentalsReason = '';
  
  if (fundamentals) {
    // For LONG: prefer positive earnings, reasonable PE, positive margins
    const hasPositiveEps = (fundamentals.eps && fundamentals.eps > 0) ?? false;
    const hasReasonablePE = (fundamentals.pe_ratio && fundamentals.pe_ratio > 0 && fundamentals.pe_ratio < 50) ?? false;
    const hasPositiveMargin = (fundamentals.profit_margin && fundamentals.profit_margin > 0) ?? false;
    
    fundamentalsPass = hasPositiveEps && (hasReasonablePE || hasPositiveMargin);
    fundamentalsReason = fundamentalsPass 
      ? `EPS: ${fundamentals.eps?.toFixed(2)}, PE: ${fundamentals.pe_ratio?.toFixed(1)}, Margin: ${(fundamentals.profit_margin ? fundamentals.profit_margin * 100 : 0).toFixed(1)}%`
      : 'Fundamentals not strong enough';
  }
  
  // Distance from EMA50
  const distanceFromEma50Pct = ((currentPrice - ema50) / ema50) * 100;
  
  // LONG: EMA50 > EMA200 (long-term uptrend) + fundamentals pass + low volatility
  if (ema50 > ema200 && currentPrice > ema50 && fundamentalsPass) {
    return {
      should_enter: true,
      direction: 'long',
      reason: `Long-term uptrend (EMA50: ${ema50.toFixed(2)} > EMA200: ${ema200.toFixed(2)}), low volatility (${volatilityPct.toFixed(2)}%), ${fundamentalsReason}`,
    };
  }
  
  // SHORT: EMA50 < EMA200 (long-term downtrend) + low volatility
  // Note: For INVESTOR short, we're less strict on fundamentals since we're betting against the stock
  if (ema50 < ema200 && currentPrice < ema50) {
    return {
      should_enter: true,
      direction: 'short',
      reason: `Long-term downtrend (EMA50: ${ema50.toFixed(2)} < EMA200: ${ema200.toFixed(2)}), low volatility (${volatilityPct.toFixed(2)}%)`,
    };
  }
  
  return {
    should_enter: false,
    direction: 'none',
    reason: fundamentalsPass 
      ? 'No clear long-term trend or price position'
      : `Fundamentals check failed: ${fundamentalsReason}`,
  };
}

// ============================================================
// MAIN ENTRY EVALUATOR
// ============================================================

/**
 * Evaluate entry signal based on engine type
 */
export function evaluateBacktestEntry(
  engine: EngineType,
  bars: OHLCBar[],
  fundamentals?: FundamentalsData
): EntrySignal {
  switch (engine) {
    case 'DAYTRADER':
      return evaluateDaytraderEntry(bars);
    
    case 'SWING':
      return evaluateSwingEntry(bars);
    
    case 'INVESTOR':
      return evaluateInvestorEntry(bars, fundamentals);
    
    default:
      console.warn(`Unknown engine type: ${engine}, defaulting to SWING`);
      return evaluateSwingEntry(bars);
  }
}
