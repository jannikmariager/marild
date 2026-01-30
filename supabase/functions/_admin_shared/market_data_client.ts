/**
 * Market Data Client for fetching closing/current prices
 * Supports multiple providers: Polygon, Finnhub, Yahoo Finance
 */

import { logDataCost } from '../_shared/data_cost_logger.ts';

export interface PriceData {
  ticker: string;
  price: number;
  timestamp: string;
  source: string;
}

/**
 * Fetch current/closing price from Polygon.io
 */
async function fetchFromPolygon(ticker: string): Promise<PriceData | null> {
  const apiKey = Deno.env.get("POLYGON_API_KEY");
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${apiKey}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    
    // Log cost
    await logDataCost({ provider: 'polygon.io' });
    
    return {
      ticker,
      price: data.results?.p || data.results?.price,
      timestamp: new Date().toISOString(),
      source: "polygon",
    };
  } catch (error) {
    console.error(`Polygon fetch failed for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch current price from Finnhub
 */
async function fetchFromFinnhub(ticker: string): Promise<PriceData | null> {
  const apiKey = Deno.env.get("FINNHUB_API_KEY");
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    
    // Log cost
    await logDataCost({ provider: 'finnhub' });
    
    return {
      ticker,
      price: data.c, // Current price
      timestamp: new Date().toISOString(),
      source: "finnhub",
    };
  } catch (error) {
    console.error(`Finnhub fetch failed for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch current price from Yahoo Finance (via existing edge function)
 */
async function fetchFromYahoo(ticker: string): Promise<PriceData | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/get_quote`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ ticker }),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    
    // Log cost (Yahoo Finance is free, but we track usage)
    await logDataCost({ provider: 'yahoo_finance' });
    
    return {
      ticker,
      price: data.regularMarketPrice || data.price,
      timestamp: new Date().toISOString(),
      source: "yahoo",
    };
  } catch (error) {
    console.error(`Yahoo fetch failed for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch closing price with fallback across providers
 * Tries: Polygon → Finnhub → Yahoo Finance
 */
export async function fetchClosingPrice(ticker: string): Promise<PriceData | null> {
  // Try Polygon first (most reliable for US stocks)
  let priceData = await fetchFromPolygon(ticker);
  if (priceData) return priceData;

  // Fallback to Finnhub
  priceData = await fetchFromFinnhub(ticker);
  if (priceData) return priceData;

  // Last resort: Yahoo Finance
  priceData = await fetchFromYahoo(ticker);
  if (priceData) return priceData;

  console.error(`All providers failed for ${ticker}`);
  return null;
}

/**
 * Batch fetch closing prices for multiple tickers
 * Returns map of ticker → price data
 */
export async function fetchClosingPricesBatch(
  tickers: string[]
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();

  // Fetch with rate limiting (1 request per 100ms to avoid hitting limits)
  for (const ticker of tickers) {
    const priceData = await fetchClosingPrice(ticker);
    if (priceData) {
      results.set(ticker, priceData);
    }
    
    // Rate limit delay
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return results;
}
