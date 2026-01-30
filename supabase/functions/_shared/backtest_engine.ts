/**
 * Backtest Engine
 * 
 * Deterministic backtesting with position management, partial exits, and R-based tracking.
 * 
 * ALL BACKTEST LOGIC IS PRO GATED
 * 
 * Features:
 * - ATR-based SL/TP calculation per engine
 * - Partial exits at TP1 (50% for DAYTRADER/SWING, 40% for INVESTOR)
 * - Move SL to breakeven after TP1 hit
 * - Track TP1/TP2 hit rates separately
 * - Respect concurrent position limits per engine
 * - All execution on candle close (no intrabar lookahead)
 */

import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  Position,
  OHLCBar,
  EngineType,
  FundamentalsData,
} from './signal_types.ts';
import {
  calculatePriceLevelsByEngine,
  PriceLevels,
  getPositionManagementRule,
  calculatePositionSize,
  getRecommendedRiskPercentage,
  getMaxConcurrentPositions,
} from './price_levels_calculator.ts';
import { evaluateBacktestEntry, EntrySignal } from './backtest_entry_rules.ts';

// ============================================================
// POSITION MANAGEMENT
// ============================================================

/**
 * Check if price hit stop loss
 */
function checkStopLoss(
  position: Position,
  bar: OHLCBar
): boolean {
  if (position.direction === 'long') {
    // LONG: SL below entry
    return bar.low <= position.stop_loss;
  } else {
    // SHORT: SL above entry
    return bar.high >= position.stop_loss;
  }
}

/**
 * Clamp R multiple to worst-case -3R (DAYTRADER only)
 */
function clampDaytraderLoss(rMultiple: number, pnl: number, entryPrice: number, positionSize: number): { rMultiple: number; pnl: number } {
  if (rMultiple < -3.0) {
    // Clamp R to -3.0 and adjust PnL proportionally
    const clampedR = -3.0;
    const clampedPnl = (pnl / rMultiple) * clampedR;
    return { rMultiple: clampedR, pnl: clampedPnl };
  }
  return { rMultiple, pnl };
}

/**
 * Check if price hit TP1
 */
function checkTP1(
  position: Position,
  bar: OHLCBar
): boolean {
  if (position.direction === 'long') {
    // LONG: TP1 above entry
    return bar.high >= position.take_profit_1;
  } else {
    // SHORT: TP1 below entry
    return bar.low <= position.take_profit_1;
  }
}

/**
 * Check if price hit TP2
 */
function checkTP2(
  position: Position,
  bar: OHLCBar
): boolean {
  if (position.direction === 'long') {
    // LONG: TP2 above TP1
    return bar.high >= position.take_profit_2;
  } else {
    // SHORT: TP2 below TP1
    return bar.low <= position.take_profit_2;
  }
}

/**
 * Process position exits for a single bar
 * Priority: SL -> TP1 -> TP2
 * For DAYTRADER: conservative intrabar sequencing + clamp loss to -3R
 */
function processPositionExits(
  position: Position,
  bar: OHLCBar,
  engine: EngineType
): BacktestTrade | null {
  const isDaytrader = engine === 'DAYTRADER';
  
  // DAYTRADER: Conservative intrabar sequencing
  // If SL and TP both hit in same bar, assume SL first (worst case)
  if (isDaytrader) {
    const slHit = checkStopLoss(position, bar);
    const tp1Hit = !position.tp1_hit && checkTP1(position, bar);
    const tp2Hit = position.tp1_hit && !position.tp2_hit && checkTP2(position, bar);
    
    // If SL and TP1/TP2 both hit same bar, SL takes priority
    if (slHit && (tp1Hit || tp2Hit)) {
      // Conservative: SL hit first
      const exitPrice = position.stop_loss;
      let pnl = position.direction === 'long'
        ? (exitPrice - position.entry_price) * position.current_size
        : (position.entry_price - exitPrice) * position.current_size;
      
      let rMultiple = (exitPrice - position.entry_price) / position.r_value;
      let actualRMultiple = position.direction === 'long' ? rMultiple : -rMultiple;
      
      // Clamp DAYTRADER loss to -3R
      const clamped = clampDaytraderLoss(actualRMultiple, pnl, position.entry_price, position.current_size);
      actualRMultiple = clamped.rMultiple;
      pnl = clamped.pnl;
      
      return {
        entry_date: position.entry_date,
        exit_date: bar.timestamp,
        direction: position.direction,
        entry_price: position.entry_price,
        exit_price: exitPrice,
        stop_loss: position.stop_loss,
        take_profit_1: position.take_profit_1,
        take_profit_2: position.take_profit_2,
        position_size: position.position_size,
        r_value: position.r_value,
        r_multiple_achieved: actualRMultiple,
        exit_reason: 'sl',
        pnl,
        pnl_pct: (pnl / (position.entry_price * position.position_size)) * 100,
        tp1_hit: position.tp1_hit,
        tp2_hit: false,
        equity_after: 0,
      };
    }
  }
  
  // Check SL first (highest priority)
  if (checkStopLoss(position, bar)) {
    const exitPrice = position.stop_loss;
    let pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.current_size
      : (position.entry_price - exitPrice) * position.current_size;
    
    let rMultiple = (exitPrice - position.entry_price) / position.r_value;
    let actualRMultiple = position.direction === 'long' ? rMultiple : -rMultiple;
    
    // Clamp DAYTRADER loss to -3R
    if (isDaytrader) {
      const clamped = clampDaytraderLoss(actualRMultiple, pnl, position.entry_price, position.current_size);
      actualRMultiple = clamped.rMultiple;
      pnl = clamped.pnl;
    }
    
    return {
      entry_date: position.entry_date,
      exit_date: bar.timestamp,
      direction: position.direction,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      stop_loss: position.stop_loss,
      take_profit_1: position.take_profit_1,
      take_profit_2: position.take_profit_2,
      position_size: position.position_size,
      r_value: position.r_value,
      r_multiple_achieved: actualRMultiple,
      exit_reason: 'sl',
      pnl,
      pnl_pct: (pnl / (position.entry_price * position.position_size)) * 100,
      tp1_hit: position.tp1_hit,
      tp2_hit: false,
      equity_after: 0, // Will be set by caller
    };
  }
  
  // Check TP1
  if (!position.tp1_hit && checkTP1(position, bar)) {
    const posManagement = getPositionManagementRule(engine);
    const tp1_exit_pct = posManagement.tp1_close_pct / 100;
    const exitSize = position.current_size * tp1_exit_pct;
    
    const exitPrice = position.take_profit_1;
    const pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * exitSize
      : (position.entry_price - exitPrice) * exitSize;
    
    const rMultiple = (exitPrice - position.entry_price) / position.r_value;
    const actualRMultiple = position.direction === 'long' ? rMultiple : -rMultiple;
    
    // Mark TP1 as hit and move SL to breakeven
    position.tp1_hit = true;
    position.stop_loss = position.entry_price;
    position.current_size = position.current_size - exitSize;
    
    return {
      entry_date: position.entry_date,
      exit_date: bar.timestamp,
      direction: position.direction,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      stop_loss: position.entry_price, // Now at breakeven
      take_profit_1: position.take_profit_1,
      take_profit_2: position.take_profit_2,
      position_size: exitSize, // Partial exit
      r_value: position.r_value,
      r_multiple_achieved: actualRMultiple,
      exit_reason: 'tp1',
      pnl,
      pnl_pct: (pnl / (position.entry_price * exitSize)) * 100,
      tp1_hit: true,
      tp2_hit: false,
      equity_after: 0, // Will be set by caller
    };
  }
  
  // Check TP2 (only if TP1 already hit)
  if (position.tp1_hit && !position.tp2_hit && checkTP2(position, bar)) {
    const exitPrice = position.take_profit_2;
    const exitSize = position.current_size; // Close remaining position
    
    const pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * exitSize
      : (position.entry_price - exitPrice) * exitSize;
    
    const rMultiple = (exitPrice - position.entry_price) / position.r_value;
    const actualRMultiple = position.direction === 'long' ? rMultiple : -rMultiple;
    
    // Mark TP2 as hit
    position.tp2_hit = true;
    position.status = 'closed';
    position.current_size = 0;
    
    return {
      entry_date: position.entry_date,
      exit_date: bar.timestamp,
      direction: position.direction,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      stop_loss: position.stop_loss,
      take_profit_1: position.take_profit_1,
      take_profit_2: position.take_profit_2,
      position_size: exitSize,
      r_value: position.r_value,
      r_multiple_achieved: actualRMultiple,
      exit_reason: 'tp2',
      pnl,
      pnl_pct: (pnl / (position.entry_price * exitSize)) * 100,
      tp1_hit: position.tp1_hit,
      tp2_hit: true,
      equity_after: 0, // Will be set by caller
    };
  }
  
  return null;
}

// ============================================================
// MAIN BACKTEST ENGINE
// ============================================================

/**
 * Run backtest for a single symbol with engine-specific rules
 */
export async function runBacktest(
  config: BacktestConfig,
  bars: OHLCBar[],
  fundamentals?: FundamentalsData
): Promise<BacktestResult> {
  const {
    engine_type,
    symbol,
    timeframe,
    start_date,
    end_date,
    starting_equity,
    risk_per_trade_pct,
    max_concurrent_positions,
  } = config;
  
  const isDaytrader = engine_type === 'DAYTRADER';
  
  // Initialize state
  let currentEquity = starting_equity;
  let peakEquity = starting_equity;
  let maxDrawdown = 0;
  let daytraderEquityZero = false; // Flag to stop new DAYTRADER trades if equity hits 0
  
  const openPositions: Position[] = [];
  const closedTrades: BacktestTrade[] = [];
  const equityCurve: Array<{ date: string; equity: number }> = [
    { date: start_date, equity: starting_equity },
  ];
  
  // DAYTRADER frequency limits
  const daytraderOpenBySymbol = new Map<string, boolean>(); // Max 1 open per symbol
  const daytraderTradesPerDay = new Map<string, Map<string, number>>(); // [symbol][date] -> count
  const daytraderLastTradePerDay = new Map<string, Map<string, { direction: 'long' | 'short'; r: number }>>(); // [symbol][date] -> last trade
  
  // Filter bars by date range
  const startTime = new Date(start_date).getTime();
  const endTime = new Date(end_date).getTime();
  const backtestBars = bars.filter(bar => {
    const barTime = new Date(bar.timestamp).getTime();
    return barTime >= startTime && barTime <= endTime;
  });
  
  console.log(`Running backtest for ${symbol} (${engine_type}):`);
  console.log(`  Bars: ${backtestBars.length}`);
  console.log(`  Starting equity: $${starting_equity.toLocaleString()}`);
  console.log(`  Risk per trade: ${risk_per_trade_pct}%`);
  console.log(`  Max concurrent: ${max_concurrent_positions}`);
  
  // Main backtest loop - process each bar
  for (let i = 0; i < backtestBars.length; i++) {
    const bar = backtestBars[i];
    
    // 1. Process exits for all open positions
    for (let j = openPositions.length - 1; j >= 0; j--) {
      const position = openPositions[j];
      const trade = processPositionExits(position, bar, engine_type);
      
      if (trade) {
        // Apply PnL
        const newEquity = currentEquity + trade.pnl;
        
        // DAYTRADER: clamp equity to 0 and stop new trades
        if (isDaytrader && newEquity < 0) {
          currentEquity = 0;
          daytraderEquityZero = true;
          trade.equity_after = 0;
        } else {
          currentEquity = newEquity;
          trade.equity_after = currentEquity;
        }
        
        closedTrades.push(trade);
        
        // DAYTRADER: track last trade per day for duplicate direction filter
        if (isDaytrader && (trade.exit_reason === 'sl' || trade.exit_reason === 'tp1' || trade.exit_reason === 'tp2')) {
          const tradeDate = new Date(trade.entry_date).toISOString().split('T')[0];
          if (!daytraderLastTradePerDay.has(position.symbol)) {
            daytraderLastTradePerDay.set(position.symbol, new Map());
          }
          daytraderLastTradePerDay.get(position.symbol)!.set(tradeDate, {
            direction: position.direction,
            r: trade.r_multiple_achieved,
          });
        }
        
        // Remove position if fully closed
        if (position.status === 'closed' || position.current_size === 0) {
          openPositions.splice(j, 1);
          
          // DAYTRADER: mark symbol as no longer open
          if (isDaytrader) {
            daytraderOpenBySymbol.set(position.symbol, false);
          }
        }
      }
    }
    
    // 2. Check for new entry (only if we have room)
    let canEnter = openPositions.length < max_concurrent_positions;
    
    // DAYTRADER: additional frequency checks
    if (isDaytrader && canEnter && !daytraderEquityZero) {
      // Check if symbol already has open DAYTRADER position
      if (daytraderOpenBySymbol.get(symbol) === true) {
        canEnter = false;
      }
      
      // Check daily trade limit (max 4 per symbol per day)
      const barDate = new Date(bar.timestamp).toISOString().split('T')[0];
      if (!daytraderTradesPerDay.has(symbol)) {
        daytraderTradesPerDay.set(symbol, new Map());
      }
      const symbolDayMap = daytraderTradesPerDay.get(symbol)!;
      const todayCount = symbolDayMap.get(barDate) || 0;
      if (todayCount >= 4) {
        canEnter = false;
      }
    }
    
    if (canEnter) {
      // Need sufficient historical data for entry evaluation
      const historicalBars = bars.slice(0, bars.indexOf(bar) + 1);
      
      // Evaluate entry signal
      const entrySignal: EntrySignal = evaluateBacktestEntry(
        engine_type,
        historicalBars,
        fundamentals
      );
      
      if (entrySignal.should_enter && entrySignal.direction !== 'none') {
        // DAYTRADER: Check no duplicate losing direction on same day
        if (isDaytrader) {
          const barDate = new Date(bar.timestamp).toISOString().split('T')[0];
          if (!daytraderLastTradePerDay.has(symbol)) {
            daytraderLastTradePerDay.set(symbol, new Map());
          }
          const lastTrade = daytraderLastTradePerDay.get(symbol)!.get(barDate);
          if (lastTrade && lastTrade.direction === entrySignal.direction && lastTrade.r < -1.0) {
            // Skip: same direction as last losing trade on same day
            continue;
          }
        }
        
        // Calculate price levels
        const priceLevels: PriceLevels = calculatePriceLevelsByEngine(
          engine_type,
          bar.close, // Entry at close
          historicalBars,
          entrySignal.direction
        );
        
        // Calculate position size
        let positionSize = calculatePositionSize(
          currentEquity,
          isDaytrader ? 1.0 : risk_per_trade_pct, // DAYTRADER: 1% risk
          priceLevels.r_value,
          bar.close
        );
        
        // DAYTRADER: Cap notional at 25% of equity
        if (isDaytrader) {
          const notional = positionSize * bar.close;
          const maxNotional = currentEquity * 0.25;
          if (notional > maxNotional) {
            positionSize = maxNotional / bar.close;
          }
        }
        
        // Skip if position size <= 0
        if (positionSize <= 0) {
          continue;
        }
        
        // Create new position
        const newPosition: Position = {
          id: `${symbol}_${bar.timestamp}`,
          symbol,
          direction: entrySignal.direction,
          entry_date: bar.timestamp,
          entry_price: bar.close,
          position_size: positionSize,
          current_size: positionSize,
          stop_loss: priceLevels.stop_loss,
          take_profit_1: priceLevels.take_profit_1,
          take_profit_2: priceLevels.take_profit_2,
          r_value: priceLevels.r_value,
          tp1_hit: false,
          tp2_hit: false,
          status: 'open',
        };
        
        openPositions.push(newPosition);
        
        // DAYTRADER: update frequency trackers
        if (isDaytrader) {
          daytraderOpenBySymbol.set(symbol, true);
          const barDate = new Date(bar.timestamp).toISOString().split('T')[0];
          const symbolDayMap = daytraderTradesPerDay.get(symbol)!;
          symbolDayMap.set(barDate, (symbolDayMap.get(barDate) || 0) + 1);
        }
      }
    }
    
    // 3. Update equity curve (every 10 bars to reduce noise)
    if (i % 10 === 0 || i === backtestBars.length - 1) {
      equityCurve.push({
        date: bar.timestamp,
        equity: currentEquity,
      });
      
      // Track max drawdown
      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const drawdown = ((peakEquity - currentEquity) / peakEquity) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }
  
  // Close any remaining open positions at final bar close price
  const finalBar = backtestBars[backtestBars.length - 1];
  const finalTimestamp = finalBar?.timestamp || new Date(end_date).toISOString();
  
  for (const position of openPositions) {
    const exitPrice = finalBar.close;
    let pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.current_size
      : (position.entry_price - exitPrice) * position.current_size;
    
    let rMultiple = (exitPrice - position.entry_price) / position.r_value;
    let actualRMultiple = position.direction === 'long' ? rMultiple : -rMultiple;
    
    // DAYTRADER: clamp loss to -3R
    if (isDaytrader) {
      const clamped = clampDaytraderLoss(actualRMultiple, pnl, position.entry_price, position.current_size);
      actualRMultiple = clamped.rMultiple;
      pnl = clamped.pnl;
    }
    
    const newEquity = currentEquity + pnl;
    if (isDaytrader && newEquity < 0) {
      currentEquity = 0;
    } else {
      currentEquity = newEquity;
    }
    
    closedTrades.push({
      entry_date: position.entry_date,
      exit_date: finalTimestamp,
      direction: position.direction,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      stop_loss: position.stop_loss,
      take_profit_1: position.take_profit_1,
      take_profit_2: position.take_profit_2,
      position_size: position.current_size,
      r_value: position.r_value,
      r_multiple_achieved: actualRMultiple,
      exit_reason: 'manual',
      pnl,
      pnl_pct: (pnl / (position.entry_price * position.current_size)) * 100,
      tp1_hit: position.tp1_hit,
      tp2_hit: position.tp2_hit,
      equity_after: currentEquity,
    });
  }
  
  // Calculate performance metrics
  const totalTrades = closedTrades.length;
  const winningTrades = closedTrades.filter(t => t.pnl > 0).length;
  const losingTrades = totalTrades - winningTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  
  const totalReturn = ((currentEquity - starting_equity) / starting_equity) * 100;
  
  const avgR = totalTrades > 0
    ? closedTrades.reduce((sum, t) => sum + t.r_multiple_achieved, 0) / totalTrades
    : 0;
  
  const bestTradeR = closedTrades.length > 0
    ? Math.max(...closedTrades.map(t => t.r_multiple_achieved))
    : 0;
  
  let worstTradeR = closedTrades.length > 0
    ? Math.min(...closedTrades.map(t => t.r_multiple_achieved))
    : 0;
  
  // DAYTRADER: clamp worst trade to -3R
  if (isDaytrader && worstTradeR < -3.0) {
    worstTradeR = -3.0;
  }
  
  const tp1HitCount = closedTrades.filter(t => t.tp1_hit).length;
  const tp2HitCount = closedTrades.filter(t => t.tp2_hit).length;
  const tp1HitRate = totalTrades > 0 ? (tp1HitCount / totalTrades) * 100 : 0;
  const tp2HitRate = totalTrades > 0 ? (tp2HitCount / totalTrades) * 100 : 0;
  
  // DAYTRADER: clamp max drawdown to [0, 100]
  if (isDaytrader) {
    maxDrawdown = Math.max(0, Math.min(100, maxDrawdown));
  }
  
  // DAYTRADER: clamp all equity curve points to >= 0
  if (isDaytrader) {
    equityCurve.forEach(point => {
      if (point.equity < 0) {
        point.equity = 0;
      }
    });
  }
  
  // Build result
  const result: BacktestResult = {
    engine_type,
    symbol,
    timeframe,
    start_date,
    end_date,
    starting_equity,
    ending_equity: currentEquity,
    total_return_pct: totalReturn,
    max_drawdown_pct: maxDrawdown,
    win_rate_pct: winRate,
    avg_r_per_trade: avgR,
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    best_trade_r: bestTradeR,
    worst_trade_r: worstTradeR,
    tp1_hit_rate_pct: tp1HitRate,
    tp2_hit_rate_pct: tp2HitRate,
    equity_curve: equityCurve,
    trades: closedTrades,
  };
  
  console.log(`\nBacktest complete:`);
  console.log(`  Total trades: ${totalTrades}`);
  console.log(`  Win rate: ${winRate.toFixed(1)}%`);
  console.log(`  Avg R: ${avgR.toFixed(2)}R`);
  console.log(`  Total return: ${totalReturn.toFixed(2)}%`);
  console.log(`  Max drawdown: ${maxDrawdown.toFixed(2)}%`);
  console.log(`  TP1 hit rate: ${tp1HitRate.toFixed(1)}%`);
  console.log(`  TP2 hit rate: ${tp2HitRate.toFixed(1)}%`);
  
  return result;
}
