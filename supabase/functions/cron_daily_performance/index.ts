// Daily Performance Engine Cron
// Runs at 00:30 UTC (global-safe time for all markets)
// Simulates trades using 1h candles with TP/SL logic
// Tracks ALL 29 tickers from hourly signal generation for complete transparency
// PRO-only feature

import { createClient } from "jsr:@supabase/supabase-js@2";
import { fetchChart } from "../_shared/yahoo_v8_client.ts";
import type { ChartResult } from "../_shared/yahoo_v8_client.ts";

// Universe configuration from environment variable
// Format: AAPL:1h,MSFT:1h,NVDA:1h (matches hourly signal generation)
// Updated to track ALL 29 tickers generated hourly for complete transparency
const PERFORMANCE_UNIVERSE = Deno.env.get("PERFORMANCE_UNIVERSE") || 
  "AAPL:1h,MSFT:1h,NVDA:1h,TSLA:1h,META:1h,GOOGL:1h,AMZN:1h," +
  "NFLX:1h,AMD:1h,AVGO:1h,ORCL:1h,ADBE:1h,CRM:1h,INTC:1h," +
  "BRK.B:1h,JPM:1h,V:1h,MA:1h,UNH:1h,COST:1h," +
  "XOM:1h,CVX:1h,LLY:1h,KO:1h,PEP:1h," +
  "SOXL:1h,TQQQ:1h";
const STARTING_EQUITY = 100000; // $100k model portfolio
const POSITION_SIZE_FACTOR = 0.02; // 2% per trade
const MAX_BARS_WINDOW = 168; // Check up to 168 bars (~1 week of 1h candles)
const TIMEOUT_DAYS = 7; // Force close OPEN trades after 7 days (faster for 1h)

interface UniversePair {
  symbol: string;
  timeframe: string;
}

interface TradeSimulation {
  signal_id: string | null;
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT";
  entry_time: string;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  exit_time: string | null;
  exit_price: number | null;
  result: "TP" | "SL" | "TIMEOUT" | "OPEN";
  pnl_pct: number | null;
  bars_held: number | null;
}

/**
 * Parse universe configuration
 */
function parseUniverse(): UniversePair[] {
  return PERFORMANCE_UNIVERSE.split(",").map((pair) => {
    const [symbol, timeframe] = pair.trim().split(":");
    return { symbol: symbol.toUpperCase(), timeframe };
  });
}

/**
 * Determine performance date (previous UTC day)
 */
function getPerformanceDate(): Date {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  
  // Skip weekends - use Friday if yesterday was Saturday/Sunday
  const dayOfWeek = yesterday.getUTCDay();
  if (dayOfWeek === 0) { // Sunday
    yesterday.setUTCDate(yesterday.getUTCDate() - 2);
  } else if (dayOfWeek === 6) { // Saturday
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  }
  
  return yesterday;
}

/**
 * Simulate TP/SL for a single signal using 1h candles
 */
async function simulateTrade(
  signal: any,
  chartCache: Map<string, ChartResult>
): Promise<TradeSimulation> {
  const { symbol, timeframe, direction, entry_price, tp_price, sl_price, entry_time, id } = signal;
  
  // Get or fetch chart data
  const cacheKey = `${symbol}:${timeframe}`;
  let chart = chartCache.get(cacheKey);
  
  if (!chart) {
    console.log(`[simulateTrade] Fetching chart for ${cacheKey}`);
    chart = await fetchChart({
      symbol,
      interval: timeframe as any,
      range: "10d", // 10 days covers TIMEOUT_DAYS (7d) + buffer for weekends
    });
    if (chart) {
      chartCache.set(cacheKey, chart);
      // Add small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  if (!chart || !chart.timestamps || chart.timestamps.length === 0) {
    console.error(`[simulateTrade] No chart data for ${symbol}`);
    return {
      signal_id: id,
      symbol,
      timeframe,
      direction,
      entry_time,
      entry_price,
      tp_price,
      sl_price,
      exit_time: null,
      exit_price: null,
      result: "OPEN",
      pnl_pct: null,
      bars_held: null,
    };
  }
  
  // Find entry bar index
  const entryTimestamp = new Date(entry_time).getTime() / 1000;
  let entryIndex = chart.timestamps.findIndex(ts => ts >= entryTimestamp);
  if (entryIndex === -1) entryIndex = 0;
  
  // Check bars after entry
  let result: "TP" | "SL" | "TIMEOUT" | "OPEN" = "OPEN";
  let exit_price: number | null = null;
  let exit_time: string | null = null;
  let bars_held = 0;
  
  const maxIndex = Math.min(entryIndex + MAX_BARS_WINDOW, chart.timestamps.length);
  
  for (let i = entryIndex + 1; i < maxIndex; i++) {
    const high = chart.highs[i];
    const low = chart.lows[i];
    const close = chart.closes[i];
    const timestamp = chart.timestamps[i];
    
    bars_held++;
    
    if (direction === "LONG") {
      // Check SL first (conservative)
      if (low <= sl_price) {
        result = "SL";
        exit_price = sl_price;
        exit_time = new Date(timestamp * 1000).toISOString();
        break;
      }
      
      // Then check TP
      if (high >= tp_price) {
        result = "TP";
        exit_price = tp_price;
        exit_time = new Date(timestamp * 1000).toISOString();
        break;
      }
    } else { // SHORT
      // Check SL first
      if (high >= sl_price) {
        result = "SL";
        exit_price = sl_price;
        exit_time = new Date(timestamp * 1000).toISOString();
        break;
      }
      
      // Then check TP
      if (low <= tp_price) {
        result = "TP";
        exit_price = tp_price;
        exit_time = new Date(timestamp * 1000).toISOString();
        break;
      }
    }
  }
  
  // If no TP/SL hit, mark as TIMEOUT if we reached max window
  if (!exit_time && bars_held === MAX_BARS_WINDOW) {
    result = "TIMEOUT";
    const lastIndex = maxIndex - 1;
    exit_price = chart.closes[lastIndex];
    exit_time = new Date(chart.timestamps[lastIndex] * 1000).toISOString();
  }
  
  // Calculate P&L
  let pnl_pct: number | null = null;
  if (exit_price !== null) {
    const sign = direction === "LONG" ? 1 : -1;
    const rawReturn = (exit_price - entry_price) / entry_price;
    pnl_pct = sign * rawReturn * 100;
  }
  
  return {
    signal_id: id,
    symbol,
    timeframe,
    direction,
    entry_time,
    entry_price,
    tp_price,
    sl_price,
    exit_time,
    exit_price,
    result,
    pnl_pct,
    bars_held,
  };
}

/**
 * Create ai_signals record for a performance trade
 * Links the trade to the signals table for transparency
 */
async function createSignalForTrade(
  supabase: any,
  trade: TradeSimulation,
  signalData: any
): Promise<void> {
  try {
    const { error } = await supabase
      .from("ai_signals")
      .insert({
        symbol: trade.symbol,
        timeframe: trade.timeframe,
        signal_type: trade.direction === "LONG" ? "buy" : "sell",
        entry_price: trade.entry_price,
        tp_price: trade.tp_price,
        sl_price: trade.sl_price,
        confidence_score: signalData.confidence_score || 70,
        correction_risk: signalData.correction_risk || 30,
        status: "active",
        source: "performance_engine",
        performance_trade_id: signalData.trade_id,
        reasons: signalData.reasons || {},
        smc_data: signalData.smc_data || {},
        sentiment_score: signalData.sentiment_score || 0,
        created_at: trade.entry_time,
      });
    
    if (error) {
      console.error("[createSignalForTrade] Error:", error);
    } else {
      console.log(`[createSignalForTrade] Created signal for ${trade.symbol}`);
    }
  } catch (err) {
    console.error("[createSignalForTrade] Exception:", err);
  }
}

/**
 * Update ai_signals status when trade closes
 */
async function updateSignalStatus(
  supabase: any,
  tradeId: string,
  result: "TP" | "SL" | "TIMEOUT"
): Promise<void> {
  try {
    const newStatus = result === "TP" ? "tp_hit" 
                    : result === "SL" ? "sl_hit"
                    : "timed_out";
    
    const { error } = await supabase
      .from("ai_signals")
      .update({ status: newStatus })
      .eq("performance_trade_id", tradeId);
    
    if (error) {
      console.error("[updateSignalStatus] Error:", error);
    } else {
      console.log(`[updateSignalStatus] Updated signal status to ${newStatus} for trade ${tradeId}`);
    }
  } catch (err) {
    console.error("[updateSignalStatus] Exception:", err);
  }
}

/**
 * Calculate max drawdown from equity curve
 */
function calculateMaxDrawdown(dailyRows: any[]): number {
  if (dailyRows.length === 0) return 0;
  
  let peak = dailyRows[0].ending_equity;
  let maxDD = 0;
  
  for (const row of dailyRows) {
    const equity = row.ending_equity;
    if (equity > peak) {
      peak = equity;
    } else {
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDD) {
        maxDD = dd;
      }
    }
  }
  
  return maxDD;
}

Deno.serve(async (req) => {
  try {
    console.log("[cron_daily_performance] Starting daily performance calculation");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const performanceDate = getPerformanceDate();
    const dateStr = performanceDate.toISOString().split("T")[0];
    console.log(`[cron_daily_performance] Performance date: ${dateStr}`);
    
    // Parse universe
    const universe = parseUniverse();
    console.log(`[cron_daily_performance] Universe: ${universe.map(p => p.symbol).join(", ")}`);
    
    // Fetch ai_signals for the performance date that match universe
    const universeSymbols = universe.map(p => p.symbol);
    const { data: signals, error: signalsError } = await supabase
      .from("ai_signals")
      .select("id, symbol, timeframe, direction, entry_price, tp_price, sl_price, created_at")
      .in("symbol", universeSymbols)
      .gte("created_at", `${dateStr}T00:00:00Z`)
      .lt("created_at", `${dateStr}T23:59:59Z`);
    
    if (signalsError) {
      console.error("[cron_daily_performance] Error fetching signals:", signalsError);
      return new Response(JSON.stringify({ error: signalsError.message }), { status: 500 });
    }
    
    console.log(`[cron_daily_performance] Found ${signals?.length || 0} signals`);
    
    if (!signals || signals.length === 0) {
      console.log("[cron_daily_performance] No signals to process");
      return new Response(JSON.stringify({ message: "No signals for this date", date: dateStr }), { status: 200 });
    }
    
    // Check which signals are already in ai_performance_trades
    const signalIds = signals.map(s => s.id);
    const { data: existingTrades } = await supabase
      .from("ai_performance_trades")
      .select("signal_id")
      .in("signal_id", signalIds);
    
    const existingSignalIds = new Set(existingTrades?.map(t => t.signal_id) || []);
    const newSignals = signals.filter(s => !existingSignalIds.has(s.id));
    
    console.log(`[cron_daily_performance] New signals to simulate: ${newSignals.length}`);
    
    // Simulate new trades
    const chartCache = new Map<string, ChartResult>();
    const trades: TradeSimulation[] = [];
    
    for (const signal of newSignals) {
      const trade = await simulateTrade({
        ...signal,
        entry_time: signal.created_at,
      }, chartCache);
      trades.push(trade);
    }
    
    // Insert new trades and create corresponding signals
    if (trades.length > 0) {
      const { data: insertedTrades, error: insertError } = await supabase
        .from("ai_performance_trades")
        .insert(trades)
        .select("id, symbol, timeframe, direction, entry_price, tp_price, sl_price, entry_time");
      
      if (insertError) {
        console.error("[cron_daily_performance] Error inserting trades:", insertError);
        return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
      }
      
      console.log(`[cron_daily_performance] Inserted ${trades.length} new trades`);
      
      // Create signals for each inserted trade
      if (insertedTrades) {
        for (const trade of insertedTrades) {
          await createSignalForTrade(supabase, trade, {
            trade_id: trade.id,
            confidence_score: 70, // Default for performance engine
            correction_risk: 30,
            reasons: { source: "Performance Engine", note: "Auto-traded signal" },
          });
        }
      }
    }
    
    // Update OPEN trades from previous days
    const { data: openTrades, error: openError } = await supabase
      .from("ai_performance_trades")
      .select("*")
      .eq("result", "OPEN");
    
    if (!openError && openTrades && openTrades.length > 0) {
      console.log(`[cron_daily_performance] Updating ${openTrades.length} OPEN trades`);
      
      for (const trade of openTrades) {
        // Force close if older than TIMEOUT_DAYS
        const entryDate = new Date(trade.entry_time);
        const daysSinceEntry = (Date.now() - entryDate.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceEntry > TIMEOUT_DAYS) {
          // Force TIMEOUT
          await supabase
            .from("ai_performance_trades")
            .update({
              result: "TIMEOUT",
              exit_time: new Date().toISOString(),
            })
            .eq("id", trade.id);
          
          // Update corresponding signal status
          await updateSignalStatus(supabase, trade.id, "TIMEOUT");
        } else {
          // Try to update with latest chart data
          const updatedTrade = await simulateTrade(trade, chartCache);
          if (updatedTrade.result !== "OPEN") {
            await supabase
              .from("ai_performance_trades")
              .update({
                exit_time: updatedTrade.exit_time,
                exit_price: updatedTrade.exit_price,
                result: updatedTrade.result,
                pnl_pct: updatedTrade.pnl_pct,
                bars_held: updatedTrade.bars_held,
              })
              .eq("id", trade.id);
            
            // Update corresponding signal status
            await updateSignalStatus(supabase, trade.id, updatedTrade.result);
          }
        }
      }
    }
    
    // Calculate daily performance
    // Get starting equity from previous day
    const { data: previousDay } = await supabase
      .from("ai_performance_daily")
      .select("ending_equity")
      .order("date", { ascending: false })
      .limit(1)
      .single();
    
    const starting_equity = previousDay?.ending_equity || STARTING_EQUITY;
    
    // Get all closed trades for this date
    const { data: closedTrades } = await supabase
      .from("ai_performance_trades")
      .select("pnl_pct")
      .not("result", "eq", "OPEN")
      .gte("exit_time", `${dateStr}T00:00:00Z`)
      .lt("exit_time", `${dateStr}T23:59:59Z`);
    
    if (!closedTrades || closedTrades.length === 0) {
      console.log("[cron_daily_performance] No closed trades for this date");
      return new Response(JSON.stringify({ message: "No closed trades", date: dateStr }), { status: 200 });
    }
    
    // Calculate metrics
    const trades_count = closedTrades.length;
    const wins_count = closedTrades.filter(t => (t.pnl_pct || 0) > 0).length;
    const losses_count = trades_count - wins_count;
    const win_rate_pct = trades_count > 0 ? (wins_count / trades_count) * 100 : 0;
    
    const pnl_pcts = closedTrades.map(t => t.pnl_pct || 0);
    const best_trade_pct = Math.max(...pnl_pcts);
    const worst_trade_pct = Math.min(...pnl_pcts);
    
    // Calculate total P&L
    let total_pnl_amount = 0;
    for (const trade of closedTrades) {
      const pnl_pct = trade.pnl_pct || 0;
      const pnl_amount = starting_equity * (pnl_pct / 100) * POSITION_SIZE_FACTOR;
      total_pnl_amount += pnl_amount;
    }
    
    const ending_equity = starting_equity + total_pnl_amount;
    const day_pnl_pct = ((ending_equity - starting_equity) / starting_equity) * 100;
    
    // Calculate max drawdown
    const { data: allDailyRows } = await supabase
      .from("ai_performance_daily")
      .select("ending_equity")
      .order("date", { ascending: true });
    
    const max_drawdown_pct = calculateMaxDrawdown([
      ...(allDailyRows || []),
      { ending_equity },
    ]);
    
    // Upsert daily performance
    const { error: upsertError } = await supabase
      .from("ai_performance_daily")
      .upsert({
        date: dateStr,
        starting_equity,
        ending_equity,
        day_pnl_pct,
        trades_count,
        wins_count,
        losses_count,
        win_rate_pct,
        best_trade_pct,
        worst_trade_pct,
        max_drawdown_pct,
      }, { onConflict: "date" });
    
    if (upsertError) {
      console.error("[cron_daily_performance] Error upserting daily performance:", upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), { status: 500 });
    }
    
    console.log("[cron_daily_performance] Daily performance calculated successfully");
    console.log(`[cron_daily_performance] Equity: $${starting_equity.toFixed(2)} → $${ending_equity.toFixed(2)} (${day_pnl_pct.toFixed(2)}%)`);
    
    return new Response(JSON.stringify({
      success: true,
      date: dateStr,
      starting_equity,
      ending_equity,
      day_pnl_pct,
      trades_count,
      win_rate_pct,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    
  } catch (error) {
    console.error("[cron_daily_performance] Unexpected error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
