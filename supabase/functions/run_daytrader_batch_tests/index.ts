/**
 * Batch Test Framework for DAYTRADER v3 vs v3.5
 * 
 * Tests 20 tickers with both strategies in isolation:
 * - v3: evaluateDaytraderEntryV3
 * - v3.5: evaluateDaytraderEntryV35
 * 
 * EXPERIMENTAL - Does not modify production code
 * In-memory only, no DB writes
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchIntradayOHLC } from "../_shared/yahoo_v8_client.ts";
import { OHLCBar } from "../_shared/signal_types.ts";

// Import isolated backtest engines
import { 
  runIntradayDaytraderBacktestV3,
  IntradayBacktestV3Result 
} from "../_shared/backtest_intraday_v3_isolated.ts";

import { 
  runIntradayDaytraderBacktestV35,
  IntradayBacktestV35Result 
} from "../_shared/backtest_intraday_v35_isolated.ts";

const TICKERS = [
  "TQQQ", "NVDA", "AMD", "AAPL", "AMZN", "META", "MSFT", "TSLA", "NFLX",
  "COIN", "PLTR", "RIVN",
  "JNJ", "PG", "XOM", "KO",
  "SPY", "QQQ", "SOXL", "IWM"
];

// ============================================================================
// BATCH OHLC FETCHING
// ============================================================================

interface OHLCCache {
  [symbol: string]: OHLCBar[];
}

/**
 * Fetch intraday OHLC for batch of tickers with rate limit handling
 */
async function fetchIntradayBatchOHLC(
  tickers: string[],
  interval: '5m' | '15m' = '5m',
  daysBack: number = 30
): Promise<OHLCCache> {
  console.log(`[fetchIntradayBatchOHLC] Fetching ${tickers.length} tickers...`);
  
  const cache: OHLCCache = {};
  const batchSize = 3; // Process 3 at a time to avoid rate limits
  
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    console.log(`[fetchIntradayBatchOHLC] Batch ${Math.floor(i / batchSize) + 1}: ${batch.join(', ')}`);
    
    // Fetch batch in parallel
    const batchPromises = batch.map(async (symbol) => {
      try {
        const result = await fetchIntradayOHLC({ symbol, interval, daysBack });
        
        if (result && result.bars.length >= 250) {
          const bars: OHLCBar[] = result.bars.map(b => ({
            timestamp: b.timestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }));
          
          return { symbol, bars };
        } else {
          console.warn(`[fetchIntradayBatchOHLC] Insufficient data for ${symbol}: ${result?.bars.length || 0} bars`);
          return { symbol, bars: null };
        }
      } catch (error) {
        console.error(`[fetchIntradayBatchOHLC] Failed to fetch ${symbol}:`, error.message);
        return { symbol, bars: null };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const { symbol, bars } of batchResults) {
      if (bars) {
        cache[symbol] = bars;
      }
    }
    
    // Rate limit: wait 2 seconds between batches
    if (i + batchSize < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`[fetchIntradayBatchOHLC] Successfully fetched ${Object.keys(cache).length}/${tickers.length} tickers`);
  return cache;
}

// ============================================================================
// ISOLATED BACKTEST RUNNERS
// ============================================================================

/**
 * Run v3 backtest (isolated) - uses only v3 entry logic
 */
async function runV3Backtest(symbol: string, bars: OHLCBar[]): Promise<any> {
  try {
    const result = await runIntradayDaytraderBacktestV3({
      symbol,
      bars,
    });
    
    return {
      trades: result.metrics.total_trades,
      winRate: result.metrics.win_rate_pct,
      avgR: result.metrics.avg_R,
      returnPct: result.metrics.total_return_pct,
      maxDD: result.metrics.max_drawdown_pct,
    };
  } catch (error) {
    console.error(`[runV3Backtest] Error for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Run v3.5 backtest (isolated) - uses only v3.5 entry logic
 */
async function runV35Backtest(symbol: string, bars: OHLCBar[]): Promise<any> {
  try {
    const result = await runIntradayDaytraderBacktestV35({
      symbol,
      bars,
    });
    
    return {
      trades: result.metrics.total_trades,
      winRate: result.metrics.win_rate_pct,
      avgR: result.metrics.avg_R,
      returnPct: result.metrics.total_return_pct,
      maxDD: result.metrics.max_drawdown_pct,
    };
  } catch (error) {
    console.error(`[runV35Backtest] Error for ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================================
// BATCH TEST RUNNER
// ============================================================================

interface BatchTestResult {
  ticker: string;
  v3: any;
  v3_5: any;
}

/**
 * Run batch tests for all tickers - both v3 and v3.5 isolated
 */
async function runBatchDaytraderTests(ohlcCache: OHLCCache): Promise<BatchTestResult[]> {
  console.log(`[runBatchDaytraderTests] Running tests for ${Object.keys(ohlcCache).length} tickers...`);
  
  const results: BatchTestResult[] = [];
  
  for (const [ticker, bars] of Object.entries(ohlcCache)) {
    console.log(`[runBatchDaytraderTests] Testing ${ticker}...`);
    
    // Run both v3 and v3.5 backtests in parallel
    const [v3Result, v35Result] = await Promise.all([
      runV3Backtest(ticker, bars),
      runV35Backtest(ticker, bars),
    ]);
    
    results.push({
      ticker,
      v3: v3Result,
      v3_5: v35Result,
    });
    
    // Log comparison
    if (v3Result && v35Result) {
      console.log(`[runBatchDaytraderTests] ${ticker} complete:`);
      console.log(`  v3:   ${v3Result.trades} trades, ${v3Result.winRate.toFixed(1)}% win, ${v3Result.avgR.toFixed(3)} avgR`);
      console.log(`  v3.5: ${v35Result.trades} trades, ${v35Result.winRate.toFixed(1)}% win, ${v35Result.avgR.toFixed(3)} avgR`);
    }
  }
  
  return results;
}

// ============================================================================
// EDGE FUNCTION HANDLER
// ============================================================================

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
    console.log('[run_daytrader_batch_tests] Starting batch test...');
    
    // Step 1: Fetch OHLC data for all tickers
    const ohlcCache = await fetchIntradayBatchOHLC(TICKERS, '5m', 30);
    
    if (Object.keys(ohlcCache).length === 0) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch any ticker data' }),
        {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    
    // Step 2: Run batch tests
    const results = await runBatchDaytraderTests(ohlcCache);
    
    // Step 3: Return results
    console.log(`[run_daytrader_batch_tests] Completed ${results.length} tests`);
    
    return new Response(
      JSON.stringify({
        success: true,
        note: "v3 and v3.5 backtests run in full isolation with separate entry logic engines",
        results,
        summary: {
          total_tickers: TICKERS.length,
          successful_fetches: Object.keys(ohlcCache).length,
          completed_tests: results.length,
        },
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
    console.error("[run_daytrader_batch_tests] Error:", error);
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
