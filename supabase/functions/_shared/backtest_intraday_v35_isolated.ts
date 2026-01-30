/**
 * Isolated DAYTRADER v3.5 Backtest Engine
 * 
 * ONLY uses evaluateDaytraderEntryV35 - no v3 logic
 * Duplicate of backtest_intraday_experimental.ts but with v3.5 entry logic hardcoded
 */

import { OHLCBar } from './signal_types.ts';
import { evaluateDaytraderEntryV35 } from './daytrader_entry_v3_5.ts';

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

function calculateDaytraderLevels(
  entryPrice: number,
  direction: 'long' | 'short',
  atr: number
): { sl: number; tp1: number; tp2: number; r: number } {
  const minimumR = 0.002 * entryPrice;
  const r = Math.max(0.5 * atr, minimumR);

  if (direction === 'long') {
    return { sl: entryPrice - r, tp1: entryPrice + r, tp2: entryPrice + 2 * r, r };
  } else {
    return { sl: entryPrice + r, tp1: entryPrice - r, tp2: entryPrice - 2 * r, r };
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

export interface IntradayBacktestV35Result {
  trades: Array<{ r: number }>;
  metrics: {
    total_return_pct: number;
    win_rate_pct: number;
    avg_R: number;
    max_drawdown_pct: number;
    total_trades: number;
  };
}

export async function runIntradayDaytraderBacktestV35(params: {
  symbol: string;
  bars: OHLCBar[];
}): Promise<IntradayBacktestV35Result> {
  const { symbol, bars } = params;

  let equity = 100000;
  const trades: Array<{ r: number }> = [];
  let position: Position | null = null;
  const tradesPerDay: Map<string, number> = new Map();
  const lastTradeByDirectionDay: Map<string, { r: number; date: string }> = new Map();
  let equityZero = false;

  let totalR = 0;
  let peakEquity = equity;
  let maxDrawdown = 0;

  for (let i = 250; i < bars.length; i++) {
    const bar = bars[i];
    const barDate = bar.timestamp.split('T')[0];

    // Check exits
    if (position) {
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
        } else {
          const pnl = position.direction === 'long'
            ? (exitPrice - position.entry_price) * position.current_size
            : (position.entry_price - exitPrice) * position.current_size;
          equity += pnl;

          let rMultiple = (exitPrice - position.entry_price) / position.r_value;
          if (position.direction === 'short') rMultiple = -rMultiple;
          if (rMultiple < -3.0) rMultiple = -3.0;

          totalR += rMultiple;
          trades.push({ r: rMultiple });

          const directionKey = `${symbol}_${position.direction}_${barDate}`;
          lastTradeByDirectionDay.set(directionKey, { r: rMultiple, date: barDate });

          position = null;
          if (equity <= 0) {
            equity = 0;
            equityZero = true;
          }
        }
      }
    }

    // Check entries
    if (!position && !equityZero) {
      const tradesCountToday = tradesPerDay.get(barDate) || 0;
      if (tradesCountToday >= 4) continue;

      const lookbackBars5m = bars.slice(Math.max(0, i - 250), i + 1);
      if (lookbackBars5m.length < 21) continue;

      // V3.5 ENTRY LOGIC ONLY (with symbol parameter)
      const entrySignal = evaluateDaytraderEntryV35(lookbackBars5m, symbol);
      if (!entrySignal.should_enter || entrySignal.direction === 'none') continue;

      const directionKey = `${symbol}_${entrySignal.direction}_${barDate}`;
      const lastTrade = lastTradeByDirectionDay.get(directionKey);
      if (lastTrade && lastTrade.date === barDate && lastTrade.r <= -1.0) continue;

      const atr = calculateIntradayATR(lookbackBars5m, 14);
      if (atr <= 0) continue;

      const entryPrice = bar.close;
      const direction = entrySignal.direction;
      const levels = calculateDaytraderLevels(entryPrice, direction, atr);
      const positionSize = calculatePositionSize(equity, 1.0, levels.r, entryPrice);
      if (positionSize < 1) continue;

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

      tradesPerDay.set(barDate, tradesCountToday + 1);
    }

    peakEquity = Math.max(peakEquity, equity);
    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
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

    totalR += rMultiple;
    trades.push({ r: rMultiple });
  }

  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.r > 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const avgR = totalTrades > 0 ? totalR / totalTrades : 0;
  const totalReturn = ((equity - 100000) / 100000) * 100;

  return {
    trades,
    metrics: {
      total_return_pct: totalReturn,
      win_rate_pct: winRate,
      avg_R: avgR,
      max_drawdown_pct: maxDrawdown,
      total_trades: totalTrades,
    },
  };
}
