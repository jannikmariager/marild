/**
 * Massive (Polygon.io) Client for 3-Year Historical Data
 * 
 * Provides async generator for memory-safe streaming of OHLC bars
 * Supports cursor pagination for large datasets
 */

const POLYGON_API_KEY = Deno.env.get("POLYGON_API_KEY") || Deno.env.get("MASSIVE_API_KEY");

if (!POLYGON_API_KEY) {
  throw new Error("POLYGON_API_KEY or MASSIVE_API_KEY environment variable required");
}

export interface OHLCBar {
  t: number;   // timestamp (milliseconds)
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  vw?: number; // VWAP (optional)
  n?: number;  // num trades (optional)
}

export interface TimeframeConfig {
  interval: string;      // e.g., "5m", "15m", "1h"
  multiplier: number;    // e.g., 5, 15, 1
  timespan: string;      // e.g., "minute", "hour", "day"
}

// Supported timeframes
export const TIMEFRAMES: Record<string, TimeframeConfig> = {
  '5m':  { interval: '5m',  multiplier: 5,  timespan: 'minute' },
  '15m': { interval: '15m', multiplier: 15, timespan: 'minute' },
  '30m': { interval: '30m', multiplier: 30, timespan: 'minute' },
  '1h':  { interval: '1h',  multiplier: 1,  timespan: 'hour' },
  '4h':  { interval: '4h',  multiplier: 4,  timespan: 'hour' },
  '1d':  { interval: '1d',  multiplier: 1,  timespan: 'day' },
  '1w':  { interval: '1w',  multiplier: 1,  timespan: 'week' }
};

/**
 * Async generator that streams OHLC bars with cursor pagination
 * 
 * Usage:
 *   for await (const bars of fetchPaginatedBars('AAPL', '5m', '2022-01-01', '2025-12-03')) {
 *     console.log(`Got ${bars.length} bars`);
 *   }
 */
export async function* fetchPaginatedBars(
  symbol: string,
  interval: string,
  startDate: string,  // YYYY-MM-DD format
  endDate: string     // YYYY-MM-DD format
): AsyncGenerator<OHLCBar[], void, unknown> {
  const config = TIMEFRAMES[interval];
  
  if (!config) {
    throw new Error(`Unsupported interval: ${interval}. Supported: ${Object.keys(TIMEFRAMES).join(', ')}`);
  }
  
  let url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${config.multiplier}/${config.timespan}/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_API_KEY}`;
  
  let page = 1;
  let totalBars = 0;
  
  while (url) {
    console.log(`[${symbol}] ${interval} - Page ${page}...`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${symbol}] ${interval} - Error ${response.status}: ${errorText}`);
      
      // Don't throw - just stop pagination for this symbol/interval
      break;
    }
    
    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      console.log(`[${symbol}] ${interval} - No more data (page ${page})`);
      break;
    }
    
    totalBars += data.results.length;
    console.log(`[${symbol}] ${interval} - Page ${page}: ${data.results.length} bars (total: ${totalBars})`);
    
    // Yield batch of bars
    yield data.results;
    
    // Handle pagination - Polygon's next_url doesn't include API key
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_API_KEY}` : null;
    page++;
    
    // Rate limiting - 100ms between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[${symbol}] ${interval} - Complete: ${totalBars} total bars`);
}

/**
 * Fetch all bars at once (less memory-safe, use for small datasets)
 */
export async function fetchAllBars(
  symbol: string,
  interval: string,
  startDate: string,
  endDate: string
): Promise<OHLCBar[]> {
  const allBars: OHLCBar[] = [];
  
  for await (const bars of fetchPaginatedBars(symbol, interval, startDate, endDate)) {
    allBars.push(...bars);
  }
  
  return allBars;
}
