/**
 * TradeLens Full Historical OHLC Downloader System
 * 
 * Downloads 3 years of OHLC data for 150 tickers across 6 timeframes
 * Stores in ohlc-cache bucket as JSONL
 * Supports daily incremental updates
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchPaginatedBars } from "../_shared/massive_client_3y.ts";
import { 
  uploadJsonlStream, 
  appendJsonlStream, 
  fileExists 
} from "../_shared/storage_stream_3y.ts";

// 150-ticker universe (curated from SP500, NDX100, high-vol, leveraged ETFs, crypto proxies)
const TICKER_UNIVERSE = [
  // Mega-caps (20)
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK.B", "UNH", "JNJ",
  "XOM", "V", "WMT", "JPM", "PG", "MA", "CVX", "HD", "MRK", "ABBV",
  
  // Large-caps (30)
  "AVGO", "LLY", "COST", "PEP", "ADBE", "NFLX", "TMO", "CSCO", "ACN", "MCD",
  "ABT", "CRM", "DHR", "ORCL", "WFC", "BAC", "DIS", "NKE", "AMD", "TXN",
  "BMY", "QCOM", "PM", "NEE", "INTC", "RTX", "IBM", "HON", "UNP", "GE",
  
  // Tech/Growth (20)
  "PLTR", "SNOW", "DDOG", "NET", "CRWD", "ZS", "MDB", "PANW", "ROKU", "SQ",
  "SHOP", "SNAP", "UBER", "LYFT", "ABNB", "COIN", "RBLX", "U", "PATH", "DOCN",
  
  // High-volatility (20)
  "GME", "AMC", "BBBY", "BYND", "LCID", "RIVN", "NKLA", "HOOD", "SOFI", "CLOV",
  "TLRY", "SNDL", "WISH", "CLOV", "SPCE", "PLUG", "FCEL", "BLNK", "NIO", "XPEV",
  
  // Leveraged ETFs (30)
  "TQQQ", "SQQQ", "UPRO", "SPXU", "TNA", "TZA", "UDOW", "SDOW", "TECL", "TECS",
  "FAS", "FAZ", "ERX", "ERY", "LABU", "LABD", "NAIL", "DUST", "NUGT", "JNUG",
  "UCO", "SCO", "UNG", "BOIL", "KOLD", "USO", "DGAZ", "UGAZ", "XLE", "XLF",
  
  // Crypto proxies (10)
  "MSTR", "MARA", "RIOT", "CLSK", "HUT", "BITF", "BITO", "GBTC", "ETHE", "SI",
  
  // Indices/Sectors (10)
  "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "XLK", "XLV", "XLE", "XLF",
  
  // International (10)
  "EEM", "FXI", "EWJ", "EWZ", "EWW", "EWY", "INDA", "EWT", "MCHI", "ASHR"
];

// Remove duplicates
const TICKERS = [...new Set(TICKER_UNIVERSE)];

const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"];

/**
 * Calculate date range (3 years back from today)
 */
function getDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 3);
  
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0]
  };
}

/**
 * Download single symbol/interval combination
 */
async function downloadSymbolInterval(
  symbol: string,
  interval: string,
  startDate: string,
  endDate: string,
  mode: "full" | "append"
): Promise<{ success: boolean; bars: number; appended?: number; error?: string }> {
  try {
    const barsGenerator = fetchPaginatedBars(symbol, interval, startDate, endDate);
    
    if (mode === "append") {
      const result = await appendJsonlStream(symbol, interval, barsGenerator);
      return {
        success: true,
        bars: result.bars,
        appended: result.appended
      };
    } else {
      const result = await uploadJsonlStream(symbol, interval, barsGenerator);
      return {
        success: true,
        bars: result.bars
      };
    }
  } catch (error) {
    console.error(`[${symbol}] ${interval} - Error:`, error.message);
    return {
      success: false,
      bars: 0,
      error: error.message
    };
  }
}

/**
 * Main bulk download orchestrator
 */
async function runBulkDownload(
  tickers: string[],
  timeframes: string[],
  mode: "full" | "append"
): Promise<{
  success: number;
  failed: number;
  totalBars: number;
  results: Array<{
    symbol: string;
    interval: string;
    success: boolean;
    bars: number;
    appended?: number;
    error?: string;
  }>;
}> {
  const { startDate, endDate } = getDateRange();
  
  console.log(`\n=== TradeLens 3-Year Bulk OHLC Downloader ===`);
  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log(`Tickers: ${tickers.length}`);
  console.log(`Timeframes: ${timeframes.join(', ')}`);
  console.log(`Total combinations: ${tickers.length * timeframes.length}`);
  console.log(`Bucket: ohlc-cache-v2\n`);
  
  const results: Array<{
    symbol: string;
    interval: string;
    success: boolean;
    bars: number;
    appended?: number;
    error?: string;
  }> = [];
  
  let successCount = 0;
  let failedCount = 0;
  let totalBars = 0;
  
  // Process each ticker-interval combination
  for (const symbol of tickers) {
    for (const interval of timeframes) {
      console.log(`\n[${symbol}] ${interval} - Starting ${mode} mode...`);
      
      const result = await downloadSymbolInterval(
        symbol,
        interval,
        startDate,
        endDate,
        mode
      );
      
      results.push({
        symbol,
        interval,
        ...result
      });
      
      if (result.success) {
        successCount++;
        totalBars += result.bars;
        
        if (mode === "append") {
          console.log(`[${symbol}] ${interval} - ✓ Success: ${result.appended} new bars appended (${result.bars} total fetched)`);
        } else {
          console.log(`[${symbol}] ${interval} - ✓ Success: ${result.bars} bars downloaded`);
        }
      } else {
        failedCount++;
        console.log(`[${symbol}] ${interval} - ✗ Failed: ${result.error}`);
      }
      
      // Progress update every 10 combinations
      if ((successCount + failedCount) % 10 === 0) {
        console.log(`\n--- Progress: ${successCount + failedCount}/${tickers.length * timeframes.length} (${successCount} success, ${failedCount} failed) ---\n`);
      }
    }
  }
  
  return {
    success: successCount,
    failed: failedCount,
    totalBars,
    results
  };
}

/**
 * HTTP handler
 */
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "full"; // "full" or "append"
    const tickersParam = url.searchParams.get("tickers"); // comma-separated or "all"
    const timeframesParam = url.searchParams.get("timeframes"); // comma-separated or "all"
    
    // Validate mode
    if (mode !== "full" && mode !== "append") {
      return new Response(
        JSON.stringify({ error: "Invalid mode. Use 'full' or 'append'" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Parse tickers
    let tickers = TICKERS;
    if (tickersParam && tickersParam !== "all") {
      tickers = tickersParam.split(",").map(t => t.trim().toUpperCase());
    }
    
    // Parse timeframes
    let timeframes = TIMEFRAMES;
    if (timeframesParam && timeframesParam !== "all") {
      timeframes = timeframesParam.split(",").map(t => t.trim().toLowerCase());
    }
    
    // Run bulk download
    const startTime = Date.now();
    const result = await runBulkDownload(tickers, timeframes, mode);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Build summary
    const summary = {
      mode,
      duration_seconds: parseFloat(duration),
      tickers: tickers.length,
      timeframes: timeframes.length,
      total_combinations: tickers.length * timeframes.length,
      success: result.success,
      failed: result.failed,
      total_bars: result.totalBars,
      results: result.results
    };
    
    console.log(`\n=== Summary ===`);
    console.log(`Duration: ${duration}s`);
    console.log(`Success: ${result.success}/${tickers.length * timeframes.length}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Total bars: ${result.totalBars.toLocaleString()}`);
    
    return new Response(
      JSON.stringify(summary, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
