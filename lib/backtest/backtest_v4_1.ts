/**
 * Backtest Engine V4.1
 * Latest engine version with refined trend-following logic
 * 
 * Strategy:
 * - Long: Price > EMA21 > EMA50, price near EMA21 (pullback), bullish candle, volume > 80% avg
 * - Short: Price < EMA21 < EMA50, price near EMA21 (bounce), bearish candle, volume > 80% avg
 * - Stop Loss: 1.5 × ATR below entry (long) or above entry (short)
 * - Take Profit: 3 × ATR (2:1 risk/reward)
 * - More active than crossover strategy, enters on pullbacks to EMA21 in trending markets
 */

import { BacktestParams, BacktestResult, EntrySignal, OHLCBar, TechnicalIndicators } from './shared_types';
import { runBacktest, calculateEMA } from './base_runner';

export async function backtestV4_1(params: BacktestParams): Promise<BacktestResult> {
  return runBacktest(params, generateV4_1Signal);
}

function generateV4_1Signal(
  bar: OHLCBar,
  index: number,
  indicators: TechnicalIndicators,
  bars: OHLCBar[]
): EntrySignal {
  const { ema9, ema21, ema50, ema200, atr, volume_ma } = indicators;
  
  // Default: no signal
  const noSignal: EntrySignal = {
    type: null,
    confidence: 0,
    stopLoss: bar.close,
    takeProfit: bar.close,
  };
  
  // Need all indicators
  if (!ema9 || !ema21 || !ema50 || !ema200 || !atr || !volume_ma) {
    return noSignal;
  }
  
  // Get previous bar indicators for crossover detection
  if (index < 1) return noSignal;
  
  const prevBar = bars[index - 1];
  const prevCloses = bars.slice(0, index).map(b => b.close);
  
  // Calculate previous EMAs
  const prevEma21Array = calculateEMA(prevCloses, 21);
  const prevEma50Array = calculateEMA(prevCloses, 50);
  
  const prevEma21 = prevEma21Array[prevEma21Array.length - 1];
  const prevEma50 = prevEma50Array[prevEma50Array.length - 1];
  
  if (!prevEma21 || !prevEma50) return noSignal;
  
  // Volume confirmation: current volume > 80% of average (more lenient)
  const volumeConfirmed = bar.volume > (volume_ma * 0.8);
  
  // Long signal conditions:
  // 1. Price is above EMA21 (short-term uptrend)
  // 2. EMA21 > EMA50 (medium-term uptrend alignment)
  // 3. Price pulled back to near EMA21 (entry opportunity)
  // 4. Volume confirmation
  const inUptrend = bar.close > ema21 && ema21 > ema50;
  const nearEma21 = Math.abs(bar.close - ema21) / ema21 < 0.015; // Within 1.5% of EMA21
  const priceRising = bar.close > bar.open; // Bullish candle
  
  if (inUptrend && nearEma21 && priceRising && volumeConfirmed) {
    const stopLoss = bar.close - (1.5 * atr);
    const takeProfit = bar.close + (3 * atr); // 2:1 R:R
    
    return {
      type: 'long',
      confidence: 75,
      stopLoss,
      takeProfit,
    };
  }
  
  // Short signal conditions:
  // 1. Price is below EMA21 (short-term downtrend)
  // 2. EMA21 < EMA50 (medium-term downtrend alignment)
  // 3. Price bounced up to near EMA21 (entry opportunity)
  // 4. Volume confirmation
  const inDowntrend = bar.close < ema21 && ema21 < ema50;
  const nearEma21Short = Math.abs(bar.close - ema21) / ema21 < 0.015; // Within 1.5% of EMA21
  const priceFalling = bar.close < bar.open; // Bearish candle
  
  if (inDowntrend && nearEma21Short && priceFalling && volumeConfirmed) {
    const stopLoss = bar.close + (1.5 * atr);
    const takeProfit = bar.close - (3 * atr); // 2:1 R:R
    
    return {
      type: 'short',
      confidence: 75,
      stopLoss,
      takeProfit,
    };
  }
  
  return noSignal;
}
