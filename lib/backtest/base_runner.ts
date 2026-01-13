/**
 * Base Backtest Runner
 * Shared logic for running backtests across all engine versions
 */

import {
  BacktestParams,
  BacktestResult,
  OHLCBar,
  Position,
  TradeRecord,
  EquityPoint,
  BacktestStats,
  TechnicalIndicators,
  EntrySignal,
} from './shared_types';

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  
  if (data.length === 0) return ema;
  
  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < Math.min(period, data.length); i++) {
    sum += data[i];
  }
  ema.push(sum / Math.min(period, data.length));
  
  // Calculate remaining EMAs
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  
  return ema;
}

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(bars: OHLCBar[], period: number = 14): number[] {
  const atr: number[] = [];
  
  if (bars.length < 2) return atr;
  
  const trueRanges: number[] = [];
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
  
  // First ATR is SMA of TR
  let sum = 0;
  for (let i = 0; i < Math.min(period, trueRanges.length); i++) {
    sum += trueRanges[i];
  }
  atr.push(sum / Math.min(period, trueRanges.length));
  
  // Calculate remaining ATRs (smoothed)
  for (let i = 1; i < trueRanges.length; i++) {
    const smoothedATR = (atr[i - 1] * (period - 1) + trueRanges[i]) / period;
    atr.push(smoothedATR);
  }
  
  return atr;
}

/**
 * Calculate technical indicators for a given bar index
 */
export function calculateIndicators(
  bars: OHLCBar[],
  index: number
): TechnicalIndicators {
  const closes = bars.slice(0, index + 1).map(b => b.close);
  const volumes = bars.slice(0, index + 1).map(b => b.volume);
  
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const atr = calculateATR(bars.slice(0, index + 1), 14);
  const volume_ma = calculateEMA(volumes, 20);
  
  return {
    ema9: ema9[ema9.length - 1],
    ema21: ema21[ema21.length - 1],
    ema50: ema50[ema50.length - 1],
    ema200: ema200[ema200.length - 1],
    atr: atr[atr.length - 1],
    volume_ma: volume_ma[volume_ma.length - 1],
  };
}

/**
 * Check if stop loss or take profit is hit
 */
export function checkExit(
  position: Position,
  bar: OHLCBar
): { hit: boolean; price: number; reason: string } | null {
  if (position.direction === 'long') {
    // Check stop loss
    if (bar.low <= position.stopLoss) {
      return { hit: true, price: position.stopLoss, reason: 'stop_loss' };
    }
    // Check take profit
    if (bar.high >= position.takeProfit) {
      return { hit: true, price: position.takeProfit, reason: 'take_profit' };
    }
  } else {
    // Short position
    // Check stop loss (price goes up)
    if (bar.high >= position.stopLoss) {
      return { hit: true, price: position.stopLoss, reason: 'stop_loss' };
    }
    // Check take profit (price goes down)
    if (bar.low <= position.takeProfit) {
      return { hit: true, price: position.takeProfit, reason: 'take_profit' };
    }
  }
  
  return null;
}

/**
 * Calculate position size based on risk management rules
 * Risk 1% of portfolio per trade, stop loss determines position size
 */
export function calculatePositionSize(
  equity: number,
  entryPrice: number,
  stopLoss: number
): number {
  const riskAmount = equity * 0.01; // Risk 1% per trade
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  
  if (riskPerShare === 0) return 0;
  
  const shares = Math.floor(riskAmount / riskPerShare);
  
  // Make sure we can afford it
  const maxAffordableShares = Math.floor(equity * 0.95 / entryPrice); // Use max 95% of equity
  
  return Math.min(shares, maxAffordableShares);
}

/**
 * Calculate statistics from completed trades
 */
export function calculateStats(trades: TradeRecord[], equityCurve: EquityPoint[]): BacktestStats {
  if (trades.length === 0) {
    return {
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      winRatePct: 0,
      avgR: 0,
      tradeCount: 0,
      bestTradeR: 0,
      worstTradeR: 0,
    };
  }
  
  // Calculate total return
  const initialEquity = equityCurve[0]?.value || 100000;
  const finalEquity = equityCurve[equityCurve.length - 1]?.value || initialEquity;
  const totalReturnPct = ((finalEquity - initialEquity) / initialEquity) * 100;
  
  // Calculate max drawdown
  let maxDrawdownPct = 0;
  let peak = initialEquity;
  for (const point of equityCurve) {
    if (point.value > peak) {
      peak = point.value;
    }
    const drawdown = ((peak - point.value) / peak) * 100;
    if (drawdown > maxDrawdownPct) {
      maxDrawdownPct = drawdown;
    }
  }
  
  // Calculate win rate
  const wins = trades.filter(t => t.win).length;
  const winRatePct = (wins / trades.length) * 100;
  
  // Calculate R-multiples stats
  const rMultiples = trades.map(t => t.rMultiple);
  const avgR = rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length;
  const bestTradeR = Math.max(...rMultiples);
  const worstTradeR = Math.min(...rMultiples);
  
  return {
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    winRatePct: Number(winRatePct.toFixed(2)),
    avgR: Number(avgR.toFixed(2)),
    tradeCount: trades.length,
    bestTradeR: Number(bestTradeR.toFixed(2)),
    worstTradeR: Number(worstTradeR.toFixed(2)),
  };
}

/**
 * Run backtest with provided entry signal generator
 * This is the core backtest loop used by all engine versions
 */
export function runBacktest(
  params: BacktestParams,
  generateSignal: (bar: OHLCBar, index: number, indicators: TechnicalIndicators, bars: OHLCBar[]) => EntrySignal
): BacktestResult {
  const { ohlc, initialBalance } = params;
  
  let equity = initialBalance;
  let position: Position | null = null;
  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  
  // Add initial equity point
  if (ohlc.length > 0) {
    equityCurve.push({ time: ohlc[0].timestamp, value: equity });
  }
  
  // Iterate through each bar
  for (let i = 50; i < ohlc.length; i++) { // Start at 50 to have enough data for indicators
    const bar = ohlc[i];
    const indicators = calculateIndicators(ohlc, i);
    
    // Check if we have an open position
    if (position) {
      // Check for exit conditions
      const exit = checkExit(position, bar);
      
      if (exit) {
        // Close position
        const pnl = position.direction === 'long'
          ? (exit.price - position.entryPrice) * position.size
          : (position.entryPrice - exit.price) * position.size;
        
        const riskAmount = Math.abs(position.entryPrice - position.stopLoss) * position.size;
        const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
        
        equity += pnl;
        
        trades.push({
          entryTime: position.entryTime,
          exitTime: bar.timestamp,
          entryPrice: position.entryPrice,
          exitPrice: exit.price,
          direction: position.direction,
          rMultiple: Number(rMultiple.toFixed(2)),
          win: pnl > 0,
          pnl: Number(pnl.toFixed(2)),
        });
        
        position = null;
      }
    }
    
    // If no position, look for entry signal
    if (!position) {
      const signal = generateSignal(bar, i, indicators, ohlc);
      
      if (signal.type) {
        const size = calculatePositionSize(equity, bar.close, signal.stopLoss);
        
        if (size > 0) {
          position = {
            entryTime: bar.timestamp,
            entryPrice: bar.close,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            direction: signal.type,
            size,
          };
        }
      }
    }
    
    // Record equity at this point
    equityCurve.push({ time: bar.timestamp, value: equity });
  }
  
  // Close any remaining position at the end
  if (position && ohlc.length > 0) {
    const lastBar = ohlc[ohlc.length - 1];
    const pnl = position.direction === 'long'
      ? (lastBar.close - position.entryPrice) * position.size
      : (position.entryPrice - lastBar.close) * position.size;
    
    const riskAmount = Math.abs(position.entryPrice - position.stopLoss) * position.size;
    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
    
    equity += pnl;
    
    trades.push({
      entryTime: position.entryTime,
      exitTime: lastBar.timestamp,
      entryPrice: position.entryPrice,
      exitPrice: lastBar.close,
      direction: position.direction,
      rMultiple: Number(rMultiple.toFixed(2)),
      win: pnl > 0,
      pnl: Number(pnl.toFixed(2)),
    });
    
    equityCurve.push({ time: lastBar.timestamp, value: equity });
  }
  
  const stats = calculateStats(trades, equityCurve);
  
  return {
    stats,
    equityCurve,
    trades,
  };
}
