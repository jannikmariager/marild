/**
 * DAYTRADER V4.1 Backtest Engine (Relaxed SMC)
 * 
 * Based on V4 debug findings - relaxed filters for 40-60% capture rate vs V3
 * Uses same risk/SL/TP logic as V4, only entry filters changed
 */

import { OHLCBar } from './signal_types.ts';
import { evaluateDaytraderEntryV4_1 } from './daytrader_entry_v4_1.ts';

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
  breakeven_moved: boolean;
}

interface Trade {
  entry_time: number;
  exit_time: number;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  r_multiple: number;
}

export interface DaytraderV4_1BacktestParams {
  symbol: string;
  bars: OHLCBar[];
}

export interface DaytraderBacktestResult {
  trades: Trade[];
  metrics: {
    total_trades: number;
    win_rate_pct: number;
    avg_R: number;
    max_drawdown_pct: number;
    total_return_pct: number;
  };
  equity_curve: {
    time: number;
    equity: number;
  }[];
}

// Helper functions (same as V4)
function calculateIntradayATR(bars: OHLCBar[], period: number = 14): number {
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

function calculatePositionSize(
  equity: number,
  riskPct: number,
  rValue: number,
  entryPrice: number
): number {
  const dollarRisk = equity * (riskPct / 100);
  let positionSize = dollarRisk / rValue;
  const maxNotional = equity * 0.25;
  const notional = positionSize * entryPrice;
  if (notional > maxNotional) {
    positionSize = maxNotional / entryPrice;
  }
  return Math.floor(positionSize);
}

function calculateV4Levels(
  entryPrice: number,
  direction: 'long' | 'short',
  atr: number
): { sl: number; tp1: number; tp2: number; r: number } {
  const minimumR = 0.002 * entryPrice;
  const r = Math.max(0.4 * atr, minimumR);

  if (direction === 'long') {
    return {
      sl: entryPrice - r,
      tp1: entryPrice + 1.5 * r,
      tp2: entryPrice + 3.0 * r,
      r
    };
  } else {
    return {
      sl: entryPrice + r,
      tp1: entryPrice - 1.5 * r,
      tp2: entryPrice - 3.0 * r,
      r
    };
  }
}

function checkStopLoss(position: Position, bar: OHLCBar): boolean {
  return position.direction === 'long' 
    ? bar.low <= position.stop_loss
    : bar.high >= position.stop_loss;
}

function checkTP1(position: Position, bar: OHLCBar): boolean {
  return position.direction === 'long'
    ? bar.high >= position.take_profit_1
    : bar.low <= position.take_profit_1;
}

function checkTP2(position: Position, bar: OHLCBar): boolean {
  return position.direction === 'long'
    ? bar.high >= position.take_profit_2
    : bar.low <= position.take_profit_2;
}

function checkBreakeven(position: Position, bar: OHLCBar): boolean {
  if (position.breakeven_moved) return false;
  
  const onePlusR = position.direction === 'long'
    ? position.entry_price + position.r_value
    : position.entry_price - position.r_value;
  
  return position.direction === 'long'
    ? bar.high >= onePlusR
    : bar.low <= onePlusR;
}

/**
 * V4.1 BACKTEST ENGINE
 */
export async function runDaytraderBacktestV4_1(
  params: DaytraderV4_1BacktestParams
): Promise<DaytraderBacktestResult> {
  const { symbol, bars } = params;

  let equity = 100000;
  const startingEquity = equity;
  const trades: Trade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  
  let position: Position | null = null;
  const tradesPerDay: Map<string, number> = new Map();
  const entriesPerDirectionDay: Map<string, number> = new Map();
  let equityZero = false;

  let peakEquity = equity;
  let maxDrawdown = 0;

  // Start after sufficient lookback
  for (let i = 250; i < bars.length; i++) {
    const bar = bars[i];
    const barDate = bar.timestamp.split('T')[0];
    const barTime = new Date(bar.timestamp).getTime() / 1000;

    equityCurve.push({ time: barTime, equity });

    if (equity > peakEquity) {
      peakEquity = equity;
    } else {
      const drawdown = ((peakEquity - equity) / peakEquity) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // EXIT MANAGEMENT (same as V4)
    if (position) {
      if (checkBreakeven(position, bar) && !position.breakeven_moved) {
        position.stop_loss = position.entry_price;
        position.breakeven_moved = true;
      }

      const slHit = checkStopLoss(position, bar);
      const tp1Hit = !position.tp1_hit && checkTP1(position, bar);
      const tp2Hit = position.tp1_hit && !position.tp2_hit && checkTP2(position, bar);

      let exitReason: 'SL' | 'TP1' | 'TP2' | null = null;
      let exitPrice = 0;
      let partialExit = false;

      if (slHit && (tp1Hit || tp2Hit)) {
        exitReason = 'SL';
        exitPrice = position.stop_loss;
      } else if (slHit) {
        exitReason = 'SL';
        exitPrice = position.stop_loss;
      } else if (tp2Hit) {
        exitReason = 'TP2';
        exitPrice = position.take_profit_2;
      } else if (tp1Hit) {
        exitReason = 'TP1';
        exitPrice = position.take_profit_1;
        partialExit = true;
      }

      if (exitReason) {
        if (partialExit && exitReason === 'TP1') {
          const exitSize = position.current_size * 0.5;
          const pnl = position.direction === 'long'
            ? (exitPrice - position.entry_price) * exitSize
            : (position.entry_price - exitPrice) * exitSize;
          
          equity += pnl;
          position.current_size -= exitSize;
          position.tp1_hit = true;
          position.stop_loss = position.entry_price;
          position.breakeven_moved = true;
          
        } else {
          const pnl = position.direction === 'long'
            ? (exitPrice - position.entry_price) * position.current_size
            : (position.entry_price - exitPrice) * position.current_size;
          
          equity += pnl;

          let rMultiple = (exitPrice - position.entry_price) / position.r_value;
          if (position.direction === 'short') rMultiple = -rMultiple;
          if (rMultiple < -3.0) rMultiple = -3.0;

          trades.push({
            entry_time: new Date(position.entry_time).getTime() / 1000,
            exit_time: barTime,
            direction: position.direction === 'long' ? 'LONG' : 'SHORT',
            entry_price: position.entry_price,
            exit_price: exitPrice,
            r_multiple: rMultiple,
          });

          position = null;
          
          if (equity <= 0) {
            equity = 0;
            equityZero = true;
          }
        }
      }
    }

    // ENTRY MANAGEMENT - V4.1 LOGIC
    if (!position && !equityZero) {
      const tradesCountToday = tradesPerDay.get(barDate) || 0;
      if (tradesCountToday >= 4) continue;

      const lookbackBars5m = bars.slice(Math.max(0, i - 250), i + 1);
      if (lookbackBars5m.length < 50) continue;

      // *** V4.1 ENTRY LOGIC ***
      const entrySignal = evaluateDaytraderEntryV4_1(lookbackBars5m, symbol);
      if (!entrySignal.should_enter || entrySignal.direction === 'none') continue;

      // Max 2 entries per direction per day
      const directionKey = `${symbol}_${entrySignal.direction}_${barDate}`;
      const entriesThisDirectionToday = entriesPerDirectionDay.get(directionKey) || 0;
      if (entriesThisDirectionToday >= 2) continue;

      const atr = calculateIntradayATR(lookbackBars5m, 14);
      if (atr <= 0) continue;

      const entryPrice = bar.close;
      const levels = calculateV4Levels(entryPrice, entrySignal.direction, atr);
      
      const positionSize = calculatePositionSize(equity, 1.0, levels.r, entryPrice);
      if (positionSize <= 0) continue;

      position = {
        symbol,
        direction: entrySignal.direction,
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
        breakeven_moved: false,
      };

      tradesPerDay.set(barDate, tradesCountToday + 1);
      entriesPerDirectionDay.set(directionKey, entriesThisDirectionToday + 1);
    }
  }

  // Close final position
  if (position) {
    const lastBar = bars[bars.length - 1];
    const exitPrice = lastBar.close;
    const pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.current_size
      : (position.entry_price - exitPrice) * position.current_size;
    
    equity += pnl;

    let rMultiple = (exitPrice - position.entry_price) / position.r_value;
    if (position.direction === 'short') rMultiple = -rMultiple;
    if (rMultiple < -3.0) rMultiple = -3.0;

    trades.push({
      entry_time: new Date(position.entry_time).getTime() / 1000,
      exit_time: new Date(lastBar.timestamp).getTime() / 1000,
      direction: position.direction === 'long' ? 'LONG' : 'SHORT',
      entry_price: position.entry_price,
      exit_price: exitPrice,
      r_multiple: rMultiple,
    });
  }

  // Calculate metrics
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.r_multiple > 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const avgR = totalTrades > 0
    ? trades.reduce((sum, t) => sum + t.r_multiple, 0) / totalTrades
    : 0;
  const totalReturn = ((equity - startingEquity) / startingEquity) * 100;

  return {
    trades,
    metrics: {
      total_trades: totalTrades,
      win_rate_pct: winRate,
      avg_R: avgR,
      max_drawdown_pct: maxDrawdown,
      total_return_pct: totalReturn,
    },
    equity_curve: equityCurve,
  };
}
