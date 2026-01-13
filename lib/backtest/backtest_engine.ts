/**
 * PERFORMANCE V3 DEPRECATED — V3 Performance Backtest Engine (Yahoo-only,
 * local simulation). Kept temporarily as fallback. Prefer the V4 Edge-based
 * engine via /api/backtest/v4, which uses the Supabase run_backtest_v4
 * function and unified Massive+Yahoo OHLC loader.
 *
 * Performance Backtest Engine - Deterministic Historical Simulation
 * 
 * DISCLAIMER:
 * Backtested performance is based on a fixed, rules-based model strategy.
 * It is NOT a recreation of past AI signals.
 * Results are hypothetical, do not reflect actual trading, and may differ
 * substantially from real performance.
 * Past performance is not indicative of future results.
 * Trading involves risk of loss.
 * 
 * This feature provides model-based analytics only.
 * Nothing shown constitutes financial advice, investment guidance, or
 * recommendations to buy or sell any assets.
 * 
 * These results are derived from a standardized simulation applied
 * retrospectively to historical market data.
 * They should not be interpreted as a guarantee of future performance
 * or as personalized investment advice.
 * 
 * NO OpenAI calls - only rule-based technical analysis
 * Supports LONG + SHORT positions with max 2 concurrent positions
 */

import {
  BacktestParams,
  BacktestResult,
  BacktestStats,
  BacktestTrade,
  EquityCurvePoint,
  OHLCBar,
  OpenPosition,
} from "./types";
import {
  calculateEMA,
  calculateATR,
  calculateAverageVolume,
  findSwingPoints,
  calculateRelativeVolume,
  determineTrend,
  isPriceNearLevel,
} from "./indicators";
import { createClient } from "@/lib/supabaseServer";

// Configuration - Fixed Rules-Based Model
const STARTING_EQUITY = 100000; // $100k starting capital
const POSITION_SIZE_PCT = 0.15; // 15% of equity per position
const MAX_POSITIONS = 2; // Maximum 2 concurrent positions (30% total exposure)
const RISK_REWARD_RATIO = 2; // 2:1 RR (TP = 2 * SL)
const ATR_PERIOD = 14;
const EMA_FAST = 20; // Faster trend detection
const EMA_SLOW = 50; // Slower trend confirmation
const VOLUME_PERIOD = 20;
const MIN_VOLUME_MULTIPLIER = 0.8; // 0.8x average volume (more active)
const PIVOT_LOOKBACK = 10; // Look for pivots within last 10 candles
const PIVOT_DISTANCE_PCT = 0.10; // Price within 10% of pivot

/**
 * Run backtest simulation
 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  console.log(`[runBacktest] Starting backtest for ${params.symbol}, ${params.horizonDays} days`);

  // Fetch historical data from DB
  const bars = await fetchHistoricalFromDB(params.symbol, params.horizonDays);

  console.log(`[runBacktest] Received ${bars.length} bars for ${params.symbol}`);
  
  if (bars.length < 100) {
    console.error(`[runBacktest] Insufficient data: only ${bars.length} bars received`);
    console.error(`[runBacktest] Required: 100 bars minimum, Got: ${bars.length}`);
    throw new Error(`Insufficient data: only ${bars.length} bars available (need at least 100)`);
  }

  // Calculate indicators
  const closes = bars.map((b) => b.close);
  const ema20 = calculateEMA(closes, EMA_FAST);
  const ema50 = calculateEMA(closes, EMA_SLOW);
  const atr = calculateATR(bars, ATR_PERIOD);
  const avgVolume = calculateAverageVolume(bars, VOLUME_PERIOD);
  const { swingHighs, swingLows } = findSwingPoints(bars, 5);

  // Run simulation
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityCurvePoint[] = [];
  let equity = STARTING_EQUITY;
  const openPositions: OpenPosition[] = []; // Support multiple positions
  let peakEquity = STARTING_EQUITY;

  for (let i = EMA_SLOW; i < bars.length; i++) {
    const bar = bars[i];
    const currentATR = atr[i];
    const currentAvgVolume = avgVolume[i];
    const currentEMA20 = ema20[i];
    const currentEMA50 = ema50[i];

    // Update all open positions
    for (let j = openPositions.length - 1; j >= 0; j--) {
      const position = openPositions[j];
      const result = updateOpenPosition(position, bar, bars[i - 1]);
      if (result.closed) {
        const trade = createTradeRecord(position, bar, params.symbol);
        trades.push(trade);
        
        // Update equity
        const pnl = trade.pnlPct! / 100;
        const positionValue = position.size * position.entryPrice;
        equity += positionValue * pnl;
        
        // Remove closed position
        openPositions.splice(j, 1);
      }
    }

    // Record equity curve point
    const unrealizedPnL = openPositions.reduce((sum, pos) => sum + calculateUnrealizedPnL(pos, bar.close), 0);
    const currentValue = equity + unrealizedPnL;
    equityCurve.push({
      t: new Date(bar.t * 1000).toISOString(),
      equity: currentValue,
    });
    
    peakEquity = Math.max(peakEquity, currentValue);

    // Check for new entry signals (only if room for more positions)
    if (openPositions.length < MAX_POSITIONS && currentATR && currentAvgVolume && currentEMA20 && currentEMA50) {
      const relVolume = calculateRelativeVolume(bar.volume, currentAvgVolume);

      // Filter: Require sufficient volume
      if (relVolume < MIN_VOLUME_MULTIPLIER) {
        continue;
      }

      // Check if already have position in this symbol
      const hasPosition = openPositions.some(p => p.symbol === params.symbol);
      if (hasPosition) {
        continue;
      }

      // Determine trend using EMA20 vs EMA50
      const isUptrend = currentEMA20 > currentEMA50;
      const isDowntrend = currentEMA20 < currentEMA50;

      // Find recent pivots (within last 10 candles)
      const recentPivotLow = findRecentPivot(i, swingLows, bars, PIVOT_LOOKBACK, "low");
      const recentPivotHigh = findRecentPivot(i, swingHighs, bars, PIVOT_LOOKBACK, "high");

      // LONG Entry: Uptrend + price > EMA50 + near pivot low
      if (
        isUptrend &&
        bar.close > currentEMA50 &&
        recentPivotLow !== null &&
        isPriceNearLevel(bar.close, recentPivotLow, PIVOT_DISTANCE_PCT)
      ) {
        const newPosition = createPosition(
          params.symbol,
          bar,
          currentATR,
          equity,
          "LONG"
        );
        openPositions.push(newPosition);
        continue;
      }

      // SHORT Entry: Downtrend + price < EMA50 + near pivot high
      if (
        isDowntrend &&
        bar.close < currentEMA50 &&
        recentPivotHigh !== null &&
        isPriceNearLevel(bar.close, recentPivotHigh, PIVOT_DISTANCE_PCT)
      ) {
        const newPosition = createPosition(
          params.symbol,
          bar,
          currentATR,
          equity,
          "SHORT"
        );
        openPositions.push(newPosition);
        continue;
      }
    }
  }

  // Close any remaining open positions at final price
  for (const position of openPositions) {
    const finalBar = bars[bars.length - 1];
    const trade = createTradeRecord(position, finalBar, params.symbol);
    trades.push(trade);
    
    const pnl = trade.pnlPct! / 100;
    const positionValue = position.size * position.entryPrice;
    equity += positionValue * pnl;
  }

  // Calculate statistics
  const stats = calculateStats(trades, equity, STARTING_EQUITY, equityCurve, peakEquity);

  console.log(`[runBacktest] Completed: ${trades.length} trades, ${stats.profitPct.toFixed(2)}% return`);

  return {
    stats,
    equityCurve,
    trades,
  };
}

/**
 * Create a position (LONG or SHORT)
 */
function createPosition(
  symbol: string,
  bar: OHLCBar,
  atrValue: number,
  equity: number,
  direction: "LONG" | "SHORT"
): OpenPosition {
  const entryPrice = bar.close;
  
  // Set stops based on direction
  let stopLoss: number;
  let takeProfit: number;
  
  if (direction === "LONG") {
    stopLoss = entryPrice - atrValue; // 1 ATR below
    takeProfit = entryPrice + (atrValue * RISK_REWARD_RATIO); // 2 ATR above
  } else {
    stopLoss = entryPrice + atrValue; // 1 ATR above
    takeProfit = entryPrice - (atrValue * RISK_REWARD_RATIO); // 2 ATR below
  }
  
  const positionSize = (equity * POSITION_SIZE_PCT) / entryPrice;

  return {
    symbol,
    direction,
    entryPrice,
    entryTime: bar.t,
    size: positionSize,
    stopLoss,
    takeProfit,
    confidenceScore: 70, // Fixed confidence for rules-based model
    riskMode: "medium",
  };
}

/**
 * Update open position and check for exit
 */
function updateOpenPosition(
  position: OpenPosition,
  currentBar: OHLCBar,
  prevBar: OHLCBar
): { closed: boolean } {
  if (position.direction === "LONG") {
    // Check stop loss (use low of bar)
    if (currentBar.low <= position.stopLoss) {
      return { closed: true };
    }
    
    // Check take profit (use high of bar)
    if (currentBar.high >= position.takeProfit) {
      return { closed: true };
    }
  } else if (position.direction === "SHORT") {
    // Check stop loss (use high of bar)
    if (currentBar.high >= position.stopLoss) {
      return { closed: true };
    }
    
    // Check take profit (use low of bar)
    if (currentBar.low <= position.takeProfit) {
      return { closed: true };
    }
  }

  return { closed: false };
}

/**
 * Calculate unrealized P&L for open position
 */
function calculateUnrealizedPnL(position: OpenPosition, currentPrice: number): number {
  const priceDiff = position.direction === "LONG" 
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;
  
  return position.size * priceDiff;
}

/**
 * Create trade record from closed position
 */
function createTradeRecord(
  position: OpenPosition,
  exitBar: OHLCBar,
  symbol: string
): BacktestTrade {
  let exitPrice: number;
  let exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "END_OF_PERIOD";
  
  if (position.direction === "LONG") {
    // If SL hit, use SL price; if TP hit, use TP price
    if (exitBar.low <= position.stopLoss) {
      exitPrice = position.stopLoss;
      exitReason = "STOP_LOSS";
    } else if (exitBar.high >= position.takeProfit) {
      exitPrice = position.takeProfit;
      exitReason = "TAKE_PROFIT";
    } else {
      exitPrice = exitBar.close;
      exitReason = "END_OF_PERIOD";
    }
  } else {
    // SHORT position
    if (exitBar.high >= position.stopLoss) {
      exitPrice = position.stopLoss;
      exitReason = "STOP_LOSS";
    } else if (exitBar.low <= position.takeProfit) {
      exitPrice = position.takeProfit;
      exitReason = "TAKE_PROFIT";
    } else {
      exitPrice = exitBar.close;
      exitReason = "END_OF_PERIOD";
    }
  }

  // Calculate PnL correctly for both directions
  const pnlPct = position.direction === "LONG"
    ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
  const durationHours = ((exitBar.t - position.entryTime) / 3600);

  return {
    symbol,
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice,
    exitReason,
    pnlPct,
    openedAt: new Date(position.entryTime * 1000).toISOString(),
    closedAt: new Date(exitBar.t * 1000).toISOString(),
    durationHours,
    confidenceScore: position.confidenceScore,
    riskMode: position.riskMode,
  };
}

/**
 * Calculate backtest statistics
 */
function calculateStats(
  trades: BacktestTrade[],
  finalEquity: number,
  startingEquity: number,
  equityCurve: EquityCurvePoint[],
  peakEquity: number
): BacktestStats {
  const profitPct = ((finalEquity - startingEquity) / startingEquity) * 100;

  const closedTrades = trades.filter((t) => t.closedAt !== null);
  const winningTrades = closedTrades.filter((t) => (t.pnlPct || 0) > 0);
  const winRatePct = closedTrades.length > 0 
    ? (winningTrades.length / closedTrades.length) * 100 
    : 0;

  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = startingEquity;
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = ((peak - point.equity) / peak) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // Average trade duration
  const durations = closedTrades
    .map((t) => t.durationHours)
    .filter((d): d is number => d !== null);
  const avgTradeDurationHours = durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : null;

  // Best and worst trades
  const sortedByPnL = [...closedTrades].sort((a, b) => (b.pnlPct || 0) - (a.pnlPct || 0));
  const bestTrade = sortedByPnL[0]
    ? {
        symbol: sortedByPnL[0].symbol,
        pnlPct: sortedByPnL[0].pnlPct || 0,
        openedAt: sortedByPnL[0].openedAt,
        closedAt: sortedByPnL[0].closedAt || "",
      }
    : undefined;

  const worstTrade = sortedByPnL[sortedByPnL.length - 1]
    ? {
        symbol: sortedByPnL[sortedByPnL.length - 1].symbol,
        pnlPct: sortedByPnL[sortedByPnL.length - 1].pnlPct || 0,
        openedAt: sortedByPnL[sortedByPnL.length - 1].openedAt,
        closedAt: sortedByPnL[sortedByPnL.length - 1].closedAt || "",
      }
    : undefined;

  return {
    profitPct,
    winRatePct,
    maxDrawdownPct: maxDrawdown,
    tradesCount: closedTrades.length,
    avgTradeDurationHours,
    bestTrade,
    worstTrade,
  };
}

/**
 * Find recent pivot within lookback period
 */
function findRecentPivot(
  currentIdx: number,
  swingIndices: number[],
  bars: OHLCBar[],
  lookback: number,
  type: "low" | "high"
): number | null {
  // Filter pivots within lookback period
  const recentPivots = swingIndices.filter((idx) => {
    return idx >= (currentIdx - lookback) && idx < currentIdx;
  });

  if (recentPivots.length === 0) return null;

  // Return the most recent pivot level
  const mostRecentIdx = recentPivots[recentPivots.length - 1];
  return type === "low" ? bars[mostRecentIdx].low : bars[mostRecentIdx].high;
}

/**
 * Fetch historical OHLC data from database (1h bars, aggregate to daily)
 */
async function fetchHistoricalFromDB(symbol: string, horizonDays: number): Promise<OHLCBar[]> {
  const supabase = await createClient();
  
  // Calculate date range (need 100+ days for EMA100 indicator)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - horizonDays - 120); // +120 buffer for EMA100
  
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();
  
  console.log(`[fetchHistoricalFromDB] Fetching ${symbol} 1h bars from ${startTimestamp.split('T')[0]} to ${endTimestamp.split('T')[0]}`);
  
  const { data, error } = await supabase
    .from('market_ohlc_daily')
    .select('*')
    .eq('symbol', symbol)
    .gte('timestamp', startTimestamp)
    .lte('timestamp', endTimestamp)
    .order('timestamp', { ascending: true });
  
  console.log(`[fetchHistoricalFromDB] Query result: ${data?.length || 0} rows, error: ${error?.message || 'none'}`);
  
  if (error) {
    console.error(`[fetchHistoricalFromDB] DB error:`, error);
    throw new Error(`Failed to fetch data from DB: ${error.message}`);
  }
  
  if (!data || data.length === 0) {
    console.warn(`[fetchHistoricalFromDB] No data found for ${symbol}`);
    return [];
  }
  
  console.log(`[fetchHistoricalFromDB] Fetched ${data.length} 1h bars, aggregating to daily...`);
  
  // Aggregate 1h bars to daily bars
  const dailyBars = aggregateToDaily(data, symbol);
  
  console.log(`[fetchHistoricalFromDB] Aggregated to ${dailyBars.length} daily bars for ${symbol}`);
  
  return dailyBars;
}

/**
 * Aggregate 1h bars to daily OHLC bars
 */
function aggregateToDaily(hourlyData: any[], symbol: string): OHLCBar[] {
  const dailyMap = new Map<string, any[]>();
  
  // Group by date
  for (const bar of hourlyData) {
    const date = bar.timestamp.split('T')[0]; // YYYY-MM-DD
    if (!dailyMap.has(date)) {
      dailyMap.set(date, []);
    }
    dailyMap.get(date)!.push(bar);
  }
  
  // Aggregate each day
  const dailyBars: OHLCBar[] = [];
  
  for (const [date, bars] of Array.from(dailyMap.entries()).sort()) {
    if (bars.length === 0) continue;
    
    const open = bars[0].open;
    const close = bars[bars.length - 1].close;
    const high = Math.max(...bars.map(b => b.high));
    const low = Math.min(...bars.map(b => b.low));
    const volume = bars.reduce((sum, b) => sum + b.volume, 0);
    
    // Use end of day timestamp (4pm ET)
    const timestamp = new Date(date + 'T16:00:00-05:00');
    
    dailyBars.push({
      t: Math.floor(timestamp.getTime() / 1000),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  
  return dailyBars;
}
