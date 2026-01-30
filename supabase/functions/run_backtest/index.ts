/**
 * Run Backtest Edge Function
 * 
 * Executes deterministic backtests for TradeLens AI engines with engine-specific
 * SL/TP rules, position management, and performance tracking.
 * 
 * ALL PRO GATED
 * 
 * Usage:
 *   POST /run_backtest
 *   Body: {
 *     engine_type: 'DAYTRADER' | 'SWING' | 'INVESTOR',
 *     symbol: 'AAPL',
 *     timeframe: '1h' | '4h' | '1d',
 *     start_date: '2024-01-01',
 *     end_date: '2024-12-01',
 *     starting_equity?: 100000 (optional)
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { runBacktest } from "../_shared/backtest_engine.ts";
import {
  BacktestConfig,
  BacktestResult,
  EngineType,
  OHLCBar,
  FundamentalsData,
} from "../_shared/signal_types.ts";
import {
  getRecommendedRiskPercentage,
  getMaxConcurrentPositions,
} from "../_shared/price_levels_calculator.ts";
import { getDaytraderEngineForSymbol } from "../_shared/engine_router.ts";
import { runIntradayDaytraderBacktestV3 } from "../_shared/backtest_intraday_v3_isolated.ts";
import { runIntradayDaytraderBacktestV35 } from "../_shared/backtest_intraday_v35_isolated.ts";
import { loadMassiveOHLC, aggregate1hTo4h } from "../_shared/ohlc_loader.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface BacktestRequest {
  engine_type: EngineType;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  starting_equity?: number;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    // Parse request
    const body: BacktestRequest = await req.json();
    const { engine_type, symbol, timeframe, start_date, end_date, starting_equity } = body;

    // Validate inputs
    if (!engine_type || !symbol || !timeframe || !start_date || !end_date) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!["DAYTRADER", "SWING", "INVESTOR"].includes(engine_type)) {
      return new Response(
        JSON.stringify({ error: "Invalid engine_type. Must be DAYTRADER, SWING, or INVESTOR" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[run_backtest] Starting backtest for ${symbol} (${engine_type})`);
    console.log(`  Timeframe: ${timeframe}`);
    console.log(`  Date range: ${start_date} to ${end_date}`);

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // DAYTRADER ENGINE ROUTING: Check ticker status and route to correct engine
    let daytraderEngineVersion: 'V3' | 'V3_5' | null = null;
    if (engine_type === 'DAYTRADER') {
      daytraderEngineVersion = await getDaytraderEngineForSymbol(symbol);
      
      if (!daytraderEngineVersion) {
        console.log(`[run_backtest] ${symbol} is disabled for DAYTRADER engine`);
        return new Response(
          JSON.stringify({
            error: "ticker_disabled",
            message: "Ticker disabled for Daytrader engine due to poor performance history.",
            disabled_tickers: ['META', 'COIN', 'IWM'],
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
      
      console.log(`[PERFORMANCE] ${symbol} → Using engine ${daytraderEngineVersion}`);
    }

    // Fetch OHLCV data from Massive v2 bucket instead of market_ohlc_daily
    const tf = timeframe.toLowerCase();

    let baseBars: OHLCBar[] = [];

    if (tf === "1d") {
      baseBars = await loadMassiveOHLC(symbol, "1d");
    } else if (tf === "4h") {
      // Prefer native 4h if present, otherwise aggregate from 1h
      baseBars = await loadMassiveOHLC(symbol, "4h");
      if (baseBars.length === 0) {
        const hourly = await loadMassiveOHLC(symbol, "1h");
        baseBars = aggregate1hTo4h(hourly);
      }
    } else if (tf === "1h") {
      baseBars = await loadMassiveOHLC(symbol, "1h");
    } else if (tf === "1m" || tf === "3m" || tf === "5m" || tf === "15m" || tf === "30m") {
      // Allow intraday backtests for engines that support them
      baseBars = await loadMassiveOHLC(symbol, tf as any);
    } else if (tf === "1w") {
      baseBars = await loadMassiveOHLC(symbol, "1w");
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported timeframe for backtest: ${timeframe}` }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!baseBars || baseBars.length < 250) {
      return new Response(
        JSON.stringify({
          error: "Insufficient OHLCV data",
          message: `Need at least 250 bars, found ${baseBars?.length || 0}`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[run_backtest] Loaded ${baseBars.length} OHLCV bars from ohlc-cache-v2 (${timeframe})`);

    // Slice by requested date range with buffer of 250 bars before start
    const startTime = new Date(start_date).getTime();
    const endTime = new Date(end_date).getTime();

    const filteredBars = baseBars.filter((bar) => {
      const ts = new Date(bar.timestamp).getTime();
      return ts <= endTime;
    });

    const barsWithBuffer = filteredBars.slice(-Math.max(filteredBars.length, 250));

    const bars: OHLCBar[] = barsWithBuffer;

    // Fetch fundamentals (optional, for INVESTOR engine)
    let fundamentals: FundamentalsData | undefined;
    if (engine_type === "INVESTOR") {
      const { data: fundData } = await supabase
        .from("market_fundamentals")
        .select("*")
        .eq("symbol", symbol)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (fundData) {
        fundamentals = {
          ticker: fundData.symbol,
          market_cap: fundData.market_cap,
          pe_ratio: fundData.pe_ratio,
          eps: fundData.eps,
          dividend_yield: fundData.dividend_yield,
          beta: fundData.beta,
          profit_margin: fundData.profit_margin,
          operating_margin: fundData.operating_margin,
          return_on_equity: fundData.return_on_equity,
        };
      }
    }

    // Build backtest config
    const config: BacktestConfig = {
      engine_type,
      symbol,
      timeframe,
      start_date,
      end_date,
      starting_equity: starting_equity || 100000,
      risk_per_trade_pct: getRecommendedRiskPercentage(engine_type),
      max_concurrent_positions: getMaxConcurrentPositions(engine_type),
    };

    // Run backtest (use isolated engine for DAYTRADER with routing)
    console.log(`[run_backtest] Running backtest...`);
    let result: any;
    
    if (engine_type === 'DAYTRADER' && daytraderEngineVersion) {
      // Use isolated backtest engines with engine routing
      console.log(`[run_backtest] Using isolated DAYTRADER ${daytraderEngineVersion} engine`);
      
      if (daytraderEngineVersion === 'V3') {
        const v3Result = await runIntradayDaytraderBacktestV3({ symbol, bars });
        result = {
          engine_type: 'DAYTRADER',
          engine_version: 'V3',
          symbol,
          timeframe,
          start_date,
          end_date,
          starting_equity: starting_equity || 100000,
          ending_equity: starting_equity ? starting_equity + (starting_equity * v3Result.metrics.total_return_pct / 100) : 100000 + (100000 * v3Result.metrics.total_return_pct / 100),
          total_return_pct: v3Result.metrics.total_return_pct,
          max_drawdown_pct: v3Result.metrics.max_drawdown_pct,
          win_rate_pct: v3Result.metrics.win_rate_pct,
          avg_r_per_trade: v3Result.metrics.avg_R,
          total_trades: v3Result.metrics.total_trades,
          winning_trades: Math.round(v3Result.metrics.total_trades * v3Result.metrics.win_rate_pct / 100),
          losing_trades: v3Result.metrics.total_trades - Math.round(v3Result.metrics.total_trades * v3Result.metrics.win_rate_pct / 100),
          best_trade_r: null,
          worst_trade_r: null,
          tp1_hit_rate_pct: 0,
          tp2_hit_rate_pct: 0,
          equity_curve: [],
          trades: [],
        };
      } else {
        const v35Result = await runIntradayDaytraderBacktestV35({ symbol, bars });
        result = {
          engine_type: 'DAYTRADER',
          engine_version: 'V3_5',
          symbol,
          timeframe,
          start_date,
          end_date,
          starting_equity: starting_equity || 100000,
          ending_equity: starting_equity ? starting_equity + (starting_equity * v35Result.metrics.total_return_pct / 100) : 100000 + (100000 * v35Result.metrics.total_return_pct / 100),
          total_return_pct: v35Result.metrics.total_return_pct,
          max_drawdown_pct: v35Result.metrics.max_drawdown_pct,
          win_rate_pct: v35Result.metrics.win_rate_pct,
          avg_r_per_trade: v35Result.metrics.avg_R,
          total_trades: v35Result.metrics.total_trades,
          winning_trades: Math.round(v35Result.metrics.total_trades * v35Result.metrics.win_rate_pct / 100),
          losing_trades: v35Result.metrics.total_trades - Math.round(v35Result.metrics.total_trades * v35Result.metrics.win_rate_pct / 100),
          best_trade_r: null,
          worst_trade_r: null,
          tp1_hit_rate_pct: 0,
          tp2_hit_rate_pct: 0,
          equity_curve: [],
          trades: [],
        };
      }
    } else {
      // Use generic backtest engine for other engines
      result = await runBacktest(config, bars, fundamentals);
    }

    // Store result in database
    const { data: storedResult, error: storeError } = await supabase
      .from("backtest_results")
      .upsert({
        engine_type: result.engine_type,
        symbol: result.symbol,
        timeframe: result.timeframe,
        start_date: result.start_date,
        end_date: result.end_date,
        starting_equity: result.starting_equity,
        ending_equity: result.ending_equity,
        total_return_pct: result.total_return_pct,
        max_drawdown_pct: result.max_drawdown_pct,
        win_rate_pct: result.win_rate_pct,
        avg_r_per_trade: result.avg_r_per_trade,
        total_trades: result.total_trades,
        winning_trades: result.winning_trades,
        losing_trades: result.losing_trades,
        best_trade_r: result.best_trade_r,
        worst_trade_r: result.worst_trade_r,
        tp1_hit_rate_pct: result.tp1_hit_rate_pct,
        tp2_hit_rate_pct: result.tp2_hit_rate_pct,
        equity_curve: result.equity_curve,
        trades: result.trades,
      }, {
        onConflict: "engine_type,symbol,timeframe,start_date,end_date",
      })
      .select()
      .single();

    if (storeError) {
      console.error("[run_backtest] Failed to store result:", storeError);
      // Continue anyway, return the result
    } else {
      console.log(`[run_backtest] Stored result with ID: ${storedResult.id}`);
    }

    // Return result with engine_version for DAYTRADER
    return new Response(
      JSON.stringify({
        success: true,
        result: {
          ...result,
          engine_version: daytraderEngineVersion || undefined,
        },
        stored_id: storedResult?.id,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );

  } catch (error) {
    console.error("[run_backtest] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});

/**
 * Aggregate 1h bars into daily OHLC candles (kept for compatibility
 * if needed elsewhere; current backtest path uses direct 1d Massive
 * data for daily timeframes).
 */
function aggregateToDailyBars(bars: OHLCBar[]): OHLCBar[] {
  const byDate = new Map<string, OHLCBar>();

  for (const bar of bars) {
    const dateKey = new Date(bar.timestamp).toISOString().split('T')[0];
    const existing = byDate.get(dateKey);

    if (!existing) {
      byDate.set(dateKey, {
        timestamp: `${dateKey}T00:00:00.000Z`,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * Get milliseconds per bar for a timeframe
 */
function getTimeframeMs(timeframe: string): number {
  const tf = timeframe.toLowerCase();
  
  if (tf === "1m") return 60 * 1000;
  if (tf === "5m") return 5 * 60 * 1000;
  if (tf === "15m") return 15 * 60 * 1000;
  if (tf === "1h") return 60 * 60 * 1000;
  if (tf === "4h") return 4 * 60 * 60 * 1000;
  if (tf === "1d") return 24 * 60 * 60 * 1000;
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  
  // Default to 1 day
  return 24 * 60 * 60 * 1000;
}
