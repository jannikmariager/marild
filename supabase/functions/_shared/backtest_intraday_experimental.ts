/**
 * Experimental Intraday Backtest Engine (DAYTRADER ONLY)
 * 
 * DEV/INTERNAL USE ONLY - NOT FOR PRODUCTION
 * 
 * This engine runs DAYTRADER backtests on true intraday candles (5m/15m)
 * to evaluate whether investing in proper intraday data infrastructure is worthwhile.
 * 
 * Key differences from production backtest:
 * - Operates directly on 5m/15m candles (no aggregation)
 * - Computes ATR on the intraday interval
 * - No DB writes (in-memory only)
 * - Limited to specific symbols for testing
 */

import { OHLCBar } from './signal_types.ts';
import { evaluateDaytraderEntryV35 } from './daytrader_entry_v3_5.ts';

// ============================================================================
// INTERFACES
// ============================================================================

export interface IntradayBacktestResult {
  symbol: string;
  interval: '5m' | '15m';
  lookback_days: number;
  engine_type: 'DAYTRADER';
  metrics: {
    total_return_pct: number;
    win_rate_pct: number;
    avg_R: number;
    max_drawdown_pct: number;
    best_trade_R: number;
    worst_trade_R: number;
    tp1_hit_rate_pct: number;
    tp2_hit_rate_pct: number;
    total_trades: number;
    sharpe_ratio: number | null;
  };
  equity_curve: Array<{ timestamp: string; equity: number }>;
  trades: Array<{
    direction: 'LONG' | 'SHORT';
    entry_time: string;
    exit_time: string;
    entry_price: number;
    exit_price: number;
    R_multiple: number;
    exit_reason: 'SL' | 'TP1' | 'TP2' | 'PeriodEnd';
  }>;
}

interface Position {
  symbol: string;
  direction: 'long' | 'short';
  entry_time: string;
  entry_price: number;
  position_size: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  r_value: number;
  current_size: number;
  tp1_hit: boolean;
  tp2_hit: boolean;
}

// ============================================================================
// BAR AGGREGATION (5m → 15m)
// ============================================================================

/**
 * Aggregate 5m bars into 15m bars
 */
function aggregateTo15MinBars(bars5m: OHLCBar[]): OHLCBar[] {
  const bars15m: OHLCBar[] = [];
  
  for (let i = 0; i < bars5m.length; i += 3) {
    const chunk = bars5m.slice(i, i + 3);
    if (chunk.length === 0) continue;
    
    const bar15m: OHLCBar = {
      timestamp: chunk[0].timestamp,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, b) => sum + b.volume, 0),
    };
    
    bars15m.push(bar15m);
  }
  
  return bars15m;
}

// ============================================================================
// ATR CALCULATION
// ============================================================================

/**
 * Calculate ATR on intraday interval
 */
function calculateIntradayATR(bars: OHLCBar[], period: number = 14): number {
  if (bars.length < period + 1) {
    return 0;
  }

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

  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;

  return atr;
}

/**
 * Calculate position size with risk management
 */
function calculatePositionSize(
  equity: number,
  riskPct: number,
  rValue: number,
  entryPrice: number
): number {
  const dollarRisk = equity * (riskPct / 100);
  let positionSize = dollarRisk / rValue;

  // Cap notional at 25% of equity
  const maxNotional = equity * 0.25;
  const notional = positionSize * entryPrice;
  if (notional > maxNotional) {
    positionSize = maxNotional / entryPrice;
  }

  return Math.floor(positionSize);
}

/**
 * Calculate SL/TP levels for DAYTRADER
 */
function calculateDaytraderLevels(
  entryPrice: number,
  direction: 'long' | 'short',
  atr: number
): { sl: number; tp1: number; tp2: number; r: number } {
  // R = max(0.5 * ATR, 0.002 * price)
  const minimumR = 0.002 * entryPrice;
  const r = Math.max(0.5 * atr, minimumR);

  if (direction === 'long') {
    const sl = entryPrice - r;
    const tp1 = entryPrice + r;
    const tp2 = entryPrice + 2 * r;
    return { sl, tp1, tp2, r };
  } else {
    const sl = entryPrice + r;
    const tp1 = entryPrice - r;
    const tp2 = entryPrice - 2 * r;
    return { sl, tp1, tp2, r };
  }
}

// ============================================================================
// POSITION EXIT CHECKS
// ============================================================================

function checkStopLoss(position: Position, bar: OHLCBar): boolean {
  if (position.direction === 'long') {
    return bar.low <= position.stop_loss;
  } else {
    return bar.high >= position.stop_loss;
  }
}

function checkTP1(position: Position, bar: OHLCBar): boolean {
  if (position.direction === 'long') {
    return bar.high >= position.take_profit_1;
  } else {
    return bar.low <= position.take_profit_1;
  }
}

function checkTP2(position: Position, bar: OHLCBar): boolean {
  if (position.direction === 'long') {
    return bar.high >= position.take_profit_2;
  } else {
    return bar.low <= position.take_profit_2;
  }
}

// ============================================================================
// INTRADAY BACKTEST ENGINE
// ============================================================================

export async function runIntradayDaytraderBacktest(params: {
  symbol: string;
  interval: '5m' | '15m';
  bars: OHLCBar[];
}): Promise<IntradayBacktestResult> {
  const { symbol, interval, bars } = params;

  console.log(`[runIntradayDaytraderBacktest] Starting for ${symbol} with ${bars.length} ${interval} bars`);

  // Initial state
  let equity = 100000;
  const equityCurve: Array<{ timestamp: string; equity: number }> = [
    { timestamp: bars[0].timestamp, equity }
  ];
  const trades: Array<{
    direction: 'LONG' | 'SHORT';
    entry_time: string;
    exit_time: string;
    entry_price: number;
    exit_price: number;
    R_multiple: number;
    exit_reason: 'SL' | 'TP1' | 'TP2' | 'PeriodEnd';
  }> = [];

  let position: Position | null = null;
  const tradesPerDay: Map<string, number> = new Map();
  let equityZero = false;

  // Duplicate direction guard: track last trade per direction per day
  const lastTradeByDirectionDay: Map<string, { r: number; date: string }> = new Map();

  // Stats tracking
  let tp1Hits = 0;
  let tp2Hits = 0;
  let totalR = 0;
  let bestR = 0;
  let worstR = 0;
  let peakEquity = equity;
  let maxDrawdown = 0;
  
  // v3: No longer needs 15m bars (HTF confirmation removed)

  // Iterate through bars
  for (let i = 250; i < bars.length; i++) {
    const bar = bars[i];
    const barDate = bar.timestamp.split('T')[0];

    // Check exits if position exists
    if (position) {
      let exitReason: 'SL' | 'TP1' | 'TP2' | 'PeriodEnd' | null = null;
      let exitPrice = 0;
      let partialExit = false;

      // Conservative intrabar: SL before TP if both hit same bar
      const slHit = checkStopLoss(position, bar);
      const tp1Hit = !position.tp1_hit && checkTP1(position, bar);
      const tp2Hit = position.tp1_hit && !position.tp2_hit && checkTP2(position, bar);

      if (slHit && (tp1Hit || tp2Hit)) {
        // SL takes priority
        exitReason = 'SL';
        exitPrice = position.stop_loss;
      } else if (slHit) {
        exitReason = 'SL';
        exitPrice = position.stop_loss;
      } else if (tp2Hit) {
        exitReason = 'TP2';
        exitPrice = position.take_profit_2;
        tp2Hits++;
      } else if (tp1Hit) {
        exitReason = 'TP1';
        exitPrice = position.take_profit_1;
        tp1Hits++;
        partialExit = true;
      }

      // Handle exits
      if (exitReason) {
        if (partialExit && exitReason === 'TP1') {
          // Partial exit: close 50%, move SL to breakeven
          const exitSize = position.current_size * 0.5;
          let pnl = position.direction === 'long'
            ? (exitPrice - position.entry_price) * exitSize
            : (position.entry_price - exitPrice) * exitSize;

          equity += pnl;
          position.current_size -= exitSize;
          position.tp1_hit = true;
          position.stop_loss = position.entry_price; // Move to breakeven

          // Don't record trade yet, wait for final exit
        } else {
          // Full exit
          let pnl = position.direction === 'long'
            ? (exitPrice - position.entry_price) * position.current_size
            : (position.entry_price - exitPrice) * position.current_size;

          equity += pnl;

          // Calculate R multiple
          let rMultiple = (exitPrice - position.entry_price) / position.r_value;
          if (position.direction === 'short') {
            rMultiple = -rMultiple;
          }

          // Clamp to -3R worst case
          if (rMultiple < -3.0) {
            rMultiple = -3.0;
          }

          // Track stats
          totalR += rMultiple;
          if (rMultiple > bestR) bestR = rMultiple;
          if (rMultiple < worstR) worstR = rMultiple;

          // Record trade
          trades.push({
            direction: position.direction.toUpperCase() as 'LONG' | 'SHORT',
            entry_time: position.entry_time,
            exit_time: bar.timestamp,
            entry_price: position.entry_price,
            exit_price: exitPrice,
            R_multiple: rMultiple,
            exit_reason: exitReason,
          });
          
          // Update duplicate direction guard
          const directionKey = `${symbol}_${position.direction}_${barDate}`;
          lastTradeByDirectionDay.set(directionKey, { r: rMultiple, date: barDate });

          // Clear position
          position = null;

          // Check if equity hit zero
          if (equity <= 0) {
            equity = 0;
            equityZero = true;
          }
        }
      }
    }

    // Check entries if no position and equity > 0
    if (!position && !equityZero) {
      // Check daily trade limit (max 4 per day)
      const tradesCountToday = tradesPerDay.get(barDate) || 0;
      if (tradesCountToday >= 4) {
        continue;
      }

      // Prepare lookback bars for entry evaluation
      const lookbackBars5m = bars.slice(Math.max(0, i - 250), i + 1);
      if (lookbackBars5m.length < 21) {
        continue;
      }

      // Evaluate entry with Phase 3.5 v3.5 logic (symbol-specific tuning)
      const entrySignal = evaluateDaytraderEntryV35(lookbackBars5m, symbol);
      if (!entrySignal.should_enter || entrySignal.direction === 'none') {
        continue;
      }
      
      // Duplicate direction guard: block if last trade in this direction lost >= -1R today
      const directionKey = `${symbol}_${entrySignal.direction}_${barDate}`;
      const lastTrade = lastTradeByDirectionDay.get(directionKey);
      if (lastTrade && lastTrade.date === barDate && lastTrade.r <= -1.0) {
        continue; // Skip entry in this direction for rest of day
      }

      // Calculate ATR and levels
      const atr = calculateIntradayATR(lookbackBars5m, 14);
      if (atr <= 0) {
        continue;
      }

      const entryPrice = bar.close;
      const direction = entrySignal.direction;
      const levels = calculateDaytraderLevels(entryPrice, direction, atr);

      // Calculate position size
      const positionSize = calculatePositionSize(equity, 1.0, levels.r, entryPrice);
      if (positionSize < 1) {
        continue;
      }

      // Open position
      position = {
        symbol,
        direction,
        entry_time: bar.timestamp,
        entry_price: entryPrice,
        position_size: positionSize,
        stop_loss: levels.sl,
        take_profit_1: levels.tp1,
        take_profit_2: levels.tp2,
        r_value: levels.r,
        current_size: positionSize,
        tp1_hit: false,
        tp2_hit: false,
      };

      // Update trades per day counter
      tradesPerDay.set(barDate, tradesCountToday + 1);
    }

    // Track equity curve and drawdown
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    // Sample equity curve every ~100 bars to reduce size
    if (i % 100 === 0 || i === bars.length - 1) {
      equityCurve.push({ timestamp: bar.timestamp, equity: Math.max(0, equity) });
    }
  }

  // Close any open position at end
  if (position) {
    const lastBar = bars[bars.length - 1];
    const exitPrice = lastBar.close;
    let pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.current_size
      : (position.entry_price - exitPrice) * position.current_size;

    equity += pnl;

    let rMultiple = (exitPrice - position.entry_price) / position.r_value;
    if (position.direction === 'short') {
      rMultiple = -rMultiple;
    }
    if (rMultiple < -3.0) {
      rMultiple = -3.0;
    }

    totalR += rMultiple;
    if (rMultiple > bestR) bestR = rMultiple;
    if (rMultiple < worstR) worstR = rMultiple;

    trades.push({
      direction: position.direction.toUpperCase() as 'LONG' | 'SHORT',
      entry_time: position.entry_time,
      exit_time: lastBar.timestamp,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      R_multiple: rMultiple,
      exit_reason: 'PeriodEnd',
    });
  }

  // Final equity curve point
  equityCurve.push({ timestamp: bars[bars.length - 1].timestamp, equity: Math.max(0, equity) });

  // Calculate metrics
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.R_multiple > 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const avgR = totalTrades > 0 ? totalR / totalTrades : 0;
  const totalReturn = ((equity - 100000) / 100000) * 100;
  const tp1HitRate = totalTrades > 0 ? (tp1Hits / totalTrades) * 100 : 0;
  const tp2HitRate = totalTrades > 0 ? (tp2Hits / totalTrades) * 100 : 0;

  // Simple Sharpe (would need returns series for proper calc)
  const sharpeRatio = null;

  // Calculate actual lookback days
  const lookbackDays = Math.round(
    (new Date(bars[bars.length - 1].timestamp).getTime() - new Date(bars[0].timestamp).getTime()) /
    (1000 * 60 * 60 * 24)
  );

  console.log(`[runIntradayDaytraderBacktest] Completed: ${totalTrades} trades, ${totalReturn.toFixed(2)}% return`);

  return {
    symbol,
    interval,
    lookback_days: lookbackDays,
    engine_type: 'DAYTRADER',
    metrics: {
      total_return_pct: totalReturn,
      win_rate_pct: winRate,
      avg_R: avgR,
      max_drawdown_pct: maxDrawdown,
      best_trade_R: bestR,
      worst_trade_R: worstR,
      tp1_hit_rate_pct: tp1HitRate,
      tp2_hit_rate_pct: tp2HitRate,
      total_trades: totalTrades,
      sharpe_ratio: sharpeRatio,
    },
    equity_curve: equityCurve,
    trades,
  };
}
