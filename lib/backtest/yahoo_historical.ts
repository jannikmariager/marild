/**
 * Yahoo Historical Data Fetcher for Backtesting
 * Fetches OHLC data in safe batches with caching
 * NO OpenAI calls
 */

import { OHLCBar } from "./types";

// In-memory cache for historical data (10-minute TTL)
const historyCache = new Map<string, { data: OHLCBar[]; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch historical OHLC data in batches from Yahoo Finance
 * @param symbol Stock symbol (e.g. "AAPL")
 * @param timeframe Timeframe (only "1D" supported for now)
 * @param horizonDays Number of days to fetch (30, 60, or 90)
 * @returns Array of OHLC bars sorted by timestamp ascending
 */
export async function fetchHistoricalInBatches(
  symbol: string,
  timeframe: "1D",
  horizonDays: number
): Promise<OHLCBar[]> {
  // Check cache first
  const cacheKey = `${symbol}:${timeframe}:${horizonDays}`;
  const cached = historyCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[fetchHistoricalInBatches] Cache hit for ${cacheKey}`);
    return cached.data;
  }

  try {
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - horizonDays - 5); // Add 5 days buffer

    // For horizonDays <= 90, we can fetch in a single call
    // But we implement batching logic for future extensibility
    const BATCH_SIZE_DAYS = 30;
    const allBars: OHLCBar[] = [];

    let currentStart = startDate;
    
    while (currentStart < endDate) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + BATCH_SIZE_DAYS);
      
      if (currentEnd > endDate) {
        currentEnd.setTime(endDate.getTime());
      }

      const batchBars = await fetchBatch(symbol, timeframe, currentStart, currentEnd);
      allBars.push(...batchBars);

      // Move to next batch
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);

      // Small delay to avoid rate limiting
      if (currentStart < endDate) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Deduplicate by timestamp (in case of overlap)
    const uniqueBars = deduplicateBars(allBars);

    // Sort by timestamp ascending
    uniqueBars.sort((a, b) => a.t - b.t);

    // Cache the result
    historyCache.set(cacheKey, {
      data: uniqueBars,
      timestamp: Date.now(),
    });

    console.log(`[fetchHistoricalInBatches] Successfully fetched ${uniqueBars.length} bars for ${symbol}`);
    console.log(`[fetchHistoricalInBatches] Date range: ${new Date(uniqueBars[0]?.t * 1000).toISOString()} to ${new Date(uniqueBars[uniqueBars.length - 1]?.t * 1000).toISOString()}`);
    return uniqueBars;

  } catch (error) {
    console.error(`[fetchHistoricalInBatches] Error fetching ${symbol}:`, error);
    console.error(`[fetchHistoricalInBatches] Requested ${horizonDays} days of data`);
    throw new Error(`Failed to fetch historical data for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fetch a single batch of historical data from Yahoo
 */
async function fetchBatch(
  symbol: string,
  timeframe: string,
  startDate: Date,
  endDate: Date
): Promise<OHLCBar[]> {
  const interval = timeframe === "1D" ? "1d" : "1d"; // Map to Yahoo intervals
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&period1=${period1}&period2=${period2}`;

  try {
    console.log(`[fetchBatch] Fetching ${symbol} from ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      // Ensure this runs server-side only (Next.js App Router)
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`[fetchBatch] HTTP error ${response.status} for ${symbol}`);
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Parse Yahoo response format
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.warn(`[fetchBatch] No data returned for ${symbol}`);
      return [];
    }

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0];

    if (!quotes) {
      console.warn(`[fetchBatch] No quote data for ${symbol}`);
      return [];
    }

    const bars: OHLCBar[] = [];
    console.log(`[fetchBatch] Processing ${timestamps.length} timestamps for ${symbol}`);

    for (let i = 0; i < timestamps.length; i++) {
      const open = quotes.open?.[i];
      const high = quotes.high?.[i];
      const low = quotes.low?.[i];
      const close = quotes.close?.[i];
      const volume = quotes.volume?.[i];

      // Skip bars with missing data
      if (
        open == null ||
        high == null ||
        low == null ||
        close == null ||
        volume == null
      ) {
        continue;
      }

      bars.push({
        t: timestamps[i],
        open,
        high,
        low,
        close,
        volume,
      });
    }

    console.log(`[fetchBatch] Returning ${bars.length} valid bars for ${symbol}`);
    return bars;

  } catch (error) {
    console.error(`[fetchBatch] Error fetching batch for ${symbol}:`, error);
    return []; // Return empty array on error, don't fail entire backtest
  }
}

/**
 * Remove duplicate bars by timestamp
 */
function deduplicateBars(bars: OHLCBar[]): OHLCBar[] {
  const seen = new Set<number>();
  const unique: OHLCBar[] = [];

  for (const bar of bars) {
    if (!seen.has(bar.t)) {
      seen.add(bar.t);
      unique.push(bar);
    }
  }

  return unique;
}

/**
 * Clear the in-memory cache (useful for testing)
 */
export function clearHistoricalCache(): void {
  historyCache.clear();
}
