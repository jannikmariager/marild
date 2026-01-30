/**
 * Experimental Intraday Backtest Edge Function
 * 
 * DEV/INTERNAL USE ONLY - NOT FOR PRODUCTION
 * 
 * Purpose:
 * Test DAYTRADER backtest performance using true intraday candles (5m/15m)
 * fetched directly from Yahoo Finance to evaluate whether investing in
 * intraday data infrastructure is worthwhile.
 * 
 * Limitations:
 * - DAYTRADER engine only
 * - Whitelist of symbols: TQQQ, AAPL, GOOGL, TSLA, SPY
 * - No database writes (in-memory only)
 * - Limited to Yahoo's intraday data availability (~60 days)
 * 
 * Usage:
 *   POST /run_backtest_intraday_experimental
 *   Body: {
 *     symbol: 'TQQQ',
 *     interval: '5m' | '15m',
 *     days_back: 30
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchIntradayOHLC } from "../_shared/yahoo_v8_client.ts";
import { runIntradayDaytraderBacktest, IntradayBacktestResult } from "../_shared/backtest_intraday_experimental.ts";
import { OHLCBar } from "../_shared/signal_types.ts";

// Whitelist of symbols for experimental testing
const ALLOWED_SYMBOLS = ['TQQQ', 'AAPL', 'GOOGL', 'TSLA', 'SPY'];

interface BacktestRequest {
  symbol: string;
  interval: '5m' | '15m';
  days_back: number;
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
    const { symbol, interval, days_back } = body;

    // Validate inputs
    if (!symbol || !interval || !days_back) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: symbol, interval, days_back" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate symbol whitelist
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!ALLOWED_SYMBOLS.includes(normalizedSymbol)) {
      return new Response(
        JSON.stringify({
          error: `Symbol not allowed. Experimental mode limited to: ${ALLOWED_SYMBOLS.join(', ')}`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate interval
    if (!['5m', '15m'].includes(interval)) {
      return new Response(
        JSON.stringify({ error: "Interval must be '5m' or '15m'" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate days_back
    if (days_back < 7 || days_back > 90) {
      return new Response(
        JSON.stringify({ error: "days_back must be between 7 and 90" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[run_backtest_intraday_experimental] Starting for ${normalizedSymbol} ${interval} ${days_back}d`);

    // Fetch intraday data from Yahoo
    const yahooData = await fetchIntradayOHLC({
      symbol: normalizedSymbol,
      interval,
      daysBack: days_back,
    });

    if (!yahooData || yahooData.bars.length < 250) {
      return new Response(
        JSON.stringify({
          error: "Insufficient intraday data from Yahoo Finance",
          details: `Got ${yahooData?.bars.length || 0} bars, need at least 250`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[run_backtest_intraday_experimental] Fetched ${yahooData.bars.length} ${interval} bars (~${yahooData.actualDaysBack} days)`);

    // Convert to OHLCBar format
    const bars: OHLCBar[] = yahooData.bars.map(b => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));

    // Run intraday backtest
    console.log(`[run_backtest_intraday_experimental] Running intraday DAYTRADER backtest...`);
    const result: IntradayBacktestResult = await runIntradayDaytraderBacktest({
      symbol: normalizedSymbol,
      interval,
      bars,
    });

    console.log(`[run_backtest_intraday_experimental] Completed: ${result.metrics.total_trades} trades, ${result.metrics.total_return_pct.toFixed(2)}% return`);

    // Return result (NO DB WRITES)
    return new Response(
      JSON.stringify({
        success: true,
        experimental: true,
        note: "This is an experimental backtest using Yahoo intraday data. Not stored in database.",
        result,
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
    console.error("[run_backtest_intraday_experimental] Error:", error);
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
