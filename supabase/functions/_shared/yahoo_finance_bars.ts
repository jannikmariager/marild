/**
 * Market data fetcher with Polygon.io primary and Yahoo Finance V8 fallback
 * 
 * Priority:
 * 1. Polygon.io (if POLYGON_API_KEY is set)
 * 2. Yahoo Finance V8 REST API
 */

// Use the shared OHLCBar type from signal_types.ts
import { OHLCBar } from './signal_types.ts';

/**
 * Fetch 5-minute bars using Polygon.io
 */
async function fetchFromPolygon(symbol: string, days: number): Promise<OHLCBar[]> {
  const apiKey = Deno.env.get('POLYGON_API_KEY');
  if (!apiKey) {
    throw new Error('POLYGON_API_KEY not set');
  }

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  
  const fromDate = startDate.toISOString().split('T')[0];
  const toDate = endDate.toISOString().split('T')[0];

  // Massive.com (formerly Polygon.io) aggregates endpoint for 5-minute bars
  // Try both the old Polygon URL and new Massive URL
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/5/minute/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;

  console.log(`[fetchFromPolygon] Fetching ${symbol} 5m bars from ${fromDate} to ${toDate}`);

  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Polygon API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Polygon response format: { results: [ { t: timestamp_ms, o, h, l, c, v } ] }
  if (!data.results || data.results.length === 0) {
    console.warn(`[fetchFromPolygon] No data for ${symbol}`);
    return [];
  }

  const bars: OHLCBar[] = data.results.map((bar: any) => ({
    timestamp: new Date(bar.t).toISOString(), // Convert ms to ISO 8601 string
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));

  console.log(`[fetchFromPolygon] ${symbol} → ${bars.length} bars`);
  return bars;
}

/**
 * Fetch 5-minute bars using Yahoo Finance V8 API
 */
async function fetchFromYahooV8(symbol: string, days: number): Promise<OHLCBar[]> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&period1=${period1}&period2=${period2}`;

  console.log(`[fetchFromYahooV8] Fetching ${symbol} 5m bars`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Yahoo Finance API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
    throw new Error('Invalid response structure from Yahoo Finance');
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  
  if (!timestamps || timestamps.length === 0) {
    console.warn(`[fetchFromYahooV8] No data for ${symbol}`);
    return [];
  }

  const quote = result.indicators?.quote?.[0];
  if (!quote) {
    throw new Error('No quote data in response');
  }

  const { open, high, low, close, volume } = quote;
  const bars: OHLCBar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const time = timestamps[i];
    const o = open[i];
    const h = high[i];
    const l = low[i];
    const c = close[i];
    const v = volume[i];

    if (
      time != null &&
      o != null && !isNaN(o) &&
      h != null && !isNaN(h) &&
      l != null && !isNaN(l) &&
      c != null && !isNaN(c) &&
      v != null && !isNaN(v)
    ) {
      bars.push({ 
        timestamp: new Date(time * 1000).toISOString(), // Convert unix seconds to ISO string
        open: o, 
        high: h, 
        low: l, 
        close: c, 
        volume: v 
      });
    }
  }

  bars.sort((a, b) => a.time - b.time);
  console.log(`[fetchFromYahooV8] ${symbol} → ${bars.length} bars`);
  return bars;
}

/**
 * Fetch 5-minute bars for a given symbol
 * 
 * Tries Polygon.io first (if API key is set), falls back to Yahoo Finance V8
 * 
 * @param symbol - Stock ticker symbol (e.g. "AAPL", "NVDA")
 * @param interval - Time interval ("5m" only)
 * @param days - Number of days to fetch
 * @returns Array of OHLC bars sorted by time ascending
 */
export async function fetchYahooFinanceBars(
  symbol: string,
  interval: "5m",
  days: number
): Promise<OHLCBar[]> {
  // Try Polygon.io first
  const polygonKey = Deno.env.get('POLYGON_API_KEY');
  if (polygonKey) {
    try {
      const bars = await fetchFromPolygon(symbol, days);
      if (bars.length > 0) {
        return bars;
      }
      console.warn(`[fetchYahooFinanceBars] Polygon returned no data for ${symbol}, trying Yahoo...`);
    } catch (error) {
      console.warn(`[fetchYahooFinanceBars] Polygon failed for ${symbol}:`, error);
      console.log('[fetchYahooFinanceBars] Falling back to Yahoo Finance V8...');
    }
  }

  // Fallback to Yahoo Finance V8
  try {
    return await fetchFromYahooV8(symbol, days);
  } catch (error) {
    console.error(`[fetchYahooFinanceBars] Both Polygon and Yahoo failed for ${symbol}:`, error);
    throw error;
  }
}
