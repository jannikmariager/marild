// @ts-nocheck
/** 
 * Yahoo Finance v8 API Client
 * Centralized Yahoo Finance data fetching with caching and error handling
 * 
 * This module provides a unified interface to Yahoo Finance v8/v7 APIs with:
 * - Automatic retries with exponential backoff
 * - Supabase-based caching via CacheManager
 * - Consistent error handling and logging
 * - Type-safe response interfaces
 * 
 * All functions are Deno-compatible (no Node.js dependencies)
 */

import { CacheManager } from '../shared/cache.ts';

// ============================================================================
// INTERFACES
// ============================================================================

export interface QuoteResult {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  open: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currency?: string | null;
  marketState?: string | null;
}

export interface ChartResult {
  symbol: string;
  interval: string;
  timestamps: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
}

export interface NewsItem {
  title: string;
  summary: string | null;
  source: string | null;
  publishedAt: string;  // ISO format
  url: string;
  category?: string | null;
}

export interface TrendingItem {
  symbol: string;
  shortName: string | null;
  exchange: string | null;
  score?: number | null;
}

export interface FundamentalsResult {
  symbol: string;
  marketCap?: number | null;
  peRatio?: number | null;
  eps?: number | null;
  dividendYield?: number | null;
  beta?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  sector?: string | null;
  industry?: string | null;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com';
const YAHOO_BASE_URL_2 = 'https://query2.finance.yahoo.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;

// Cache TTLs (in seconds)
const CACHE_TTL = {
  QUOTE: 10,           // 10 seconds (short cache for fresher signals)
  CHART: 120,          // 2 minutes
  NEWS: 300,           // 5 minutes
  TRENDING: 300,       // 5 minutes
  FUNDAMENTALS: 21600, // 6 hours
};

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Generic fetch with retries and timeout
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = DEFAULT_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error(`[yahoo_v8_client] Attempt ${attempt + 1}/${retries + 1} failed:`, error.message);

      if (attempt === retries) {
        throw error;
      }

      // Exponential backoff: 500ms, 1000ms
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw new Error('All retry attempts exhausted');
}

/**
 * Validate ticker symbol format
 */
function isValidSymbol(symbol: string): boolean {
  if (!symbol || typeof symbol !== 'string') return false;
  const trimmed = symbol.trim();
  return trimmed.length > 0 && trimmed.length <= 15 && /^[A-Z0-9.^=-]+$/i.test(trimmed);
}

/**
 * Get cache manager instance (reused pattern from existing functions)
 */
function getCacheManager(): CacheManager | null {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn('[yahoo_v8_client] Supabase credentials not found, caching disabled');
      return null;
    }

    return new CacheManager(supabaseUrl, supabaseKey);
  } catch (error) {
    console.error('[yahoo_v8_client] Failed to initialize cache:', error);
    return null;
  }
}

// ============================================================================
// QUOTE FUNCTIONS
// ============================================================================

/**
 * Fetch single quote from Yahoo Finance v8 chart API
 */
export async function fetchQuote(symbol: string): Promise<QuoteResult | null> {
  if (!isValidSymbol(symbol)) {
    console.error(`[fetchQuote] Invalid symbol: ${symbol}`);
    return null;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const cacheKey = `quote:${normalizedSymbol}`;
  const cache = getCacheManager();

  // Check cache
  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[fetchQuote] Cache hit for ${normalizedSymbol}`);
      return cached as QuoteResult;
    }
  }

  try {
    console.log(`[fetchQuote] Fetching ${normalizedSymbol} from Yahoo`);
    
    const url = `${YAHOO_BASE_URL}/v8/finance/chart/${normalizedSymbol}?interval=1d&range=1d`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    if (!data.chart?.result?.[0]) {
      console.error(`[fetchQuote] Invalid response structure for ${normalizedSymbol}`);
      return null;
    }

    const result = data.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];

    // Get previousClose with fallback to chartPreviousClose
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
    const currentPrice = meta.regularMarketPrice ?? null;

    const quoteResult: QuoteResult = {
      symbol: meta.symbol || normalizedSymbol,
      price: currentPrice,
      change: (currentPrice && previousClose)
        ? currentPrice - previousClose
        : null,
      changePercent: (currentPrice && previousClose)
        ? ((currentPrice - previousClose) / previousClose) * 100
        : null,
      volume: meta.regularMarketVolume ?? null,
      open: quote?.open?.[0] ?? null,
      previousClose: previousClose,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      currency: meta.currency ?? null,
      marketState: meta.marketState ?? null,
    };

    // Cache the result
    if (cache) {
      await cache.set(cacheKey, quoteResult, CACHE_TTL.QUOTE);
    }

    console.log(`[fetchQuote] Successfully fetched ${normalizedSymbol}`);
    return quoteResult;
  } catch (error) {
    console.error(`[fetchQuote] Failed to fetch ${normalizedSymbol}:`, error.message);
    return null;
  }
}

/**
 * Fetch multiple quotes in parallel (optimized for watchlists)
 */
export async function fetchBulkQuotes(symbols: string[]): Promise<Record<string, QuoteResult | null>> {
  console.log(`[fetchBulkQuotes] Fetching ${symbols.length} symbols`);
  
  const results: Record<string, QuoteResult | null> = {};
  
  // Fetch all quotes in parallel
  const promises = symbols.map(async (symbol) => {
    const quote = await fetchQuote(symbol);
    return { symbol: symbol.trim().toUpperCase(), quote };
  });

  const responses = await Promise.all(promises);
  
  for (const { symbol, quote } of responses) {
    results[symbol] = quote;
  }

  return results;
}

/**
 * Fetch bars for live position monitoring with automatic fallback
 * Tries 1m bars first, falls back to 5m, then current quote
 * Returns both bars and the interval used
 */
export async function fetchPositionBars(ticker: string): Promise<{
  bars: Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }>;
  interval: '1m' | '5m' | 'quote';
  currentPrice: number | null;
} | null> {
  if (!isValidSymbol(ticker)) {
    console.error(`[fetchPositionBars] Invalid symbol: ${ticker}`);
    return null;
  }

  const normalizedSymbol = ticker.trim().toUpperCase();
  
  // Try 1m bars first
  try {
    console.log(`[fetchPositionBars] Attempting 1m bars for ${normalizedSymbol}`);
    const bars1m = await fetchIntradayOHLC({ 
      symbol: normalizedSymbol, 
      interval: '1m', 
      daysBack: 1 
    });
    
    if (bars1m?.bars && bars1m.bars.length > 0) {
      const lastBar = bars1m.bars[bars1m.bars.length - 1];
      console.log(`[fetchPositionBars] ✓ Using 1m bars for ${normalizedSymbol} (${bars1m.bars.length} bars)`);
      return {
        bars: bars1m.bars,
        interval: '1m',
        currentPrice: lastBar.close,
      };
    }
  } catch (error) {
    console.warn(`[fetchPositionBars] 1m bars failed for ${normalizedSymbol}:`, error.message);
  }
  
  // Fallback to 5m bars
  try {
    console.log(`[fetchPositionBars] Falling back to 5m bars for ${normalizedSymbol}`);
    const bars5m = await fetchIntradayOHLC({ 
      symbol: normalizedSymbol, 
      interval: '5m', 
      daysBack: 1 
    });
    
    if (bars5m?.bars && bars5m.bars.length > 0) {
      const lastBar = bars5m.bars[bars5m.bars.length - 1];
      console.log(`[fetchPositionBars] ✓ Using 5m bars for ${normalizedSymbol} (${bars5m.bars.length} bars)`);
      return {
        bars: bars5m.bars,
        interval: '5m',
        currentPrice: lastBar.close,
      };
    }
  } catch (error) {
    console.error(`[fetchPositionBars] 5m bars also failed for ${normalizedSymbol}:`, error.message);
  }
  
  // Emergency fallback: use current quote only
  try {
    console.warn(`[fetchPositionBars] Both bar fetches failed, using quote for ${normalizedSymbol}`);
    const quote = await fetchQuote(normalizedSymbol);
    
    if (quote?.price) {
      console.log(`[fetchPositionBars] ⚠ Using quote only for ${normalizedSymbol}: $${quote.price.toFixed(2)}`);
      return {
        bars: [],
        interval: 'quote',
        currentPrice: quote.price,
      };
    }
  } catch (error) {
    console.error(`[fetchPositionBars] Quote fetch also failed for ${normalizedSymbol}:`, error.message);
  }
  
  // Complete failure
  console.error(`[fetchPositionBars] ❌ All fetch attempts failed for ${normalizedSymbol}`);
  return null;
}

// ============================================================================
// CHART FUNCTIONS
// ============================================================================

/**
 * Fetch intraday OHLCV data for experimental backtests and live monitoring (NO CACHING)
 * Yahoo provides:
 * - 1m data: up to 7 days
 * - 5m data: up to 60 days
 * - 15m data: up to 60 days
 */
export async function fetchIntradayOHLC(params: {
  symbol: string;
  interval: '1m' | '5m' | '15m';
  daysBack: number;
}): Promise<{ bars: Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }>; actualDaysBack: number } | null> {
  const { symbol, interval, daysBack } = params;

  if (!isValidSymbol(symbol)) {
    console.error(`[fetchIntradayOHLC] Invalid symbol: ${symbol}`);
    return null;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  
  // Determine Yahoo range parameter based on daysBack and interval
  // Yahoo's intraday limits: 1m up to 7 days, 5m/15m up to 60 days
  let range: string;
  if (interval === '1m') {
    // 1m bars limited to 7 days max
    range = daysBack <= 1 ? '1d' : '5d';
  } else if (daysBack <= 7) {
    range = '5d';
  } else if (daysBack <= 30) {
    range = '1mo';
  } else if (daysBack <= 90) {
    range = '3mo'; // Yahoo may limit to ~60 days for intraday
  } else {
    range = '3mo'; // Max for intraday
  }

  try {
    console.log(`[fetchIntradayOHLC] Fetching ${normalizedSymbol} intraday ${interval}/${range}`);
    
    const url = `${YAHOO_BASE_URL}/v8/finance/chart/${normalizedSymbol}?interval=${interval}&range=${range}`;
    const response = await fetchWithRetry(url, {}, DEFAULT_RETRIES, 15000); // 15s timeout for larger datasets
    const data = await response.json();

    if (!data.chart?.result?.[0]) {
      console.error(`[fetchIntradayOHLC] Invalid response structure for ${normalizedSymbol}`);
      return null;
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const indicators = result.indicators?.quote?.[0];

    if (!indicators || timestamps.length === 0) {
      console.error(`[fetchIntradayOHLC] No quote indicators or timestamps for ${normalizedSymbol}`);
      return null;
    }

    // Normalize to OHLCV bars with ISO timestamps
    const bars: Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }> = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      const open = indicators.open?.[i];
      const high = indicators.high?.[i];
      const low = indicators.low?.[i];
      const close = indicators.close?.[i];
      const volume = indicators.volume?.[i];
      
      // Skip bars with null/undefined OHLC data
      if (open == null || high == null || low == null || close == null) {
        continue;
      }
      
      bars.push({
        timestamp: new Date(timestamps[i] * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: volume ?? 0,
      });
    }

    // Calculate actual days back from the data
    const actualDaysBack = bars.length > 0
      ? Math.round((Date.now() - new Date(bars[0].timestamp).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    console.log(`[fetchIntradayOHLC] Fetched ${bars.length} ${interval} bars for ${normalizedSymbol} (~${actualDaysBack} days)`);
    return { bars, actualDaysBack };
  } catch (error) {
    console.error(`[fetchIntradayOHLC] Failed to fetch ${normalizedSymbol} intraday:`, error.message);
    return null;
  }
}

/**
 * Fetch historical chart data (OHLCV)
 */
export async function fetchChart(params: {
  symbol: string;
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1wk' | '1mo';
  range: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max';
}): Promise<ChartResult | null> {
  const { symbol, interval, range } = params;

  if (!isValidSymbol(symbol)) {
    console.error(`[fetchChart] Invalid symbol: ${symbol}`);
    return null;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const cacheKey = `chart:${normalizedSymbol}:${interval}:${range}`;
  const cache = getCacheManager();

  // Check cache
  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[fetchChart] Cache hit for ${normalizedSymbol} ${interval}/${range}`);
      return cached as ChartResult;
    }
  }

  try {
    console.log(`[fetchChart] Fetching ${normalizedSymbol} chart ${interval}/${range}`);
    
    const url = `${YAHOO_BASE_URL}/v8/finance/chart/${normalizedSymbol}?interval=${interval}&range=${range}`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    if (!data.chart?.result?.[0]) {
      console.error(`[fetchChart] Invalid response structure for ${normalizedSymbol}`);
      return null;
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const indicators = result.indicators?.quote?.[0];

    if (!indicators) {
      console.error(`[fetchChart] No quote indicators for ${normalizedSymbol}`);
      return null;
    }

    const chartResult: ChartResult = {
      symbol: normalizedSymbol,
      interval,
      timestamps,
      opens: indicators.open || [],
      highs: indicators.high || [],
      lows: indicators.low || [],
      closes: indicators.close || [],
      volumes: indicators.volume || [],
    };

    // Cache the result
    if (cache) {
      await cache.set(cacheKey, chartResult, CACHE_TTL.CHART);
    }

    console.log(`[fetchChart] Successfully fetched ${normalizedSymbol} chart (${timestamps.length} bars)`);
    return chartResult;
  } catch (error) {
    console.error(`[fetchChart] Failed to fetch ${normalizedSymbol} chart:`, error.message);
    return null;
  }
}

// ============================================================================
// NEWS FUNCTIONS
// ============================================================================

/**
 * Fetch stock news from Yahoo Finance search API
 */
export async function fetchNews(symbol: string, maxItems = 20): Promise<NewsItem[]> {
  if (!isValidSymbol(symbol)) {
    console.error(`[fetchNews] Invalid symbol: ${symbol}`);
    return [];
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const cacheKey = `news:${normalizedSymbol}`;
  const cache = getCacheManager();

  // Check cache
  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[fetchNews] Cache hit for ${normalizedSymbol}`);
      return cached as NewsItem[];
    }
  }

  try {
    console.log(`[fetchNews] Fetching news for ${normalizedSymbol}`);
    
    const url = `${YAHOO_BASE_URL}/v1/finance/search?q=${normalizedSymbol}&newsCount=${maxItems}&quotesCount=0`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    const newsItems: NewsItem[] = [];
    const rawNews = data.news || [];

    for (const item of rawNews) {
      newsItems.push({
        title: item.title || '',
        summary: item.summary || null,
        source: item.publisher || null,
        publishedAt: item.providerPublishTime 
          ? new Date(item.providerPublishTime * 1000).toISOString()
          : new Date().toISOString(),
        url: item.link || '',
        category: item.type || null,
      });
    }

    // Cache the result
    if (cache) {
      await cache.set(cacheKey, newsItems, CACHE_TTL.NEWS);
    }

    console.log(`[fetchNews] Fetched ${newsItems.length} news items for ${normalizedSymbol}`);
    return newsItems;
  } catch (error) {
    console.error(`[fetchNews] Failed to fetch news for ${normalizedSymbol}:`, error.message);
    return [];
  }
}

// ============================================================================
// TRENDING FUNCTIONS
// ============================================================================

/**
 * Fetch trending stocks from Yahoo Finance
 */
export async function fetchTrending(region = 'US'): Promise<TrendingItem[]> {
  const cacheKey = `trending:${region}`;
  const cache = getCacheManager();

  // Check cache
  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[fetchTrending] Cache hit for ${region}`);
      return cached as TrendingItem[];
    }
  }

  try {
    console.log(`[fetchTrending] Fetching trending stocks for ${region}`);
    
    const url = `${YAHOO_BASE_URL}/v1/finance/trending/${region}`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    const trendingItems: TrendingItem[] = [];
    const quotes = data.finance?.result?.[0]?.quotes || [];

    for (const quote of quotes) {
      trendingItems.push({
        symbol: quote.symbol || '',
        shortName: quote.shortName || quote.longName || null,
        exchange: quote.exchange || null,
        score: quote.score || null,
      });
    }

    // Cache the result
    if (cache) {
      await cache.set(cacheKey, trendingItems, CACHE_TTL.TRENDING);
    }

    console.log(`[fetchTrending] Fetched ${trendingItems.length} trending items for ${region}`);
    return trendingItems;
  } catch (error) {
    console.error(`[fetchTrending] Failed to fetch trending for ${region}:`, error.message);
    return [];
  }
}

// ============================================================================
// FUNDAMENTALS FUNCTIONS
// ============================================================================

/**
 * Fetch fundamental data from Yahoo Finance quoteSummary API
 */
export async function fetchFundamentals(symbol: string): Promise<FundamentalsResult | null> {
  if (!isValidSymbol(symbol)) {
    console.error(`[fetchFundamentals] Invalid symbol: ${symbol}`);
    return null;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const cacheKey = `fundamentals:${normalizedSymbol}`;
  const cache = getCacheManager();

  // Check cache
  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[fetchFundamentals] Cache hit for ${normalizedSymbol}`);
      return cached as FundamentalsResult;
    }
  }

  try {
    console.log(`[fetchFundamentals] Fetching fundamentals for ${normalizedSymbol}`);
    
    const modules = 'summaryDetail,defaultKeyStatistics,assetProfile';
    const url = `${YAHOO_BASE_URL}/v10/finance/quoteSummary/${normalizedSymbol}?modules=${modules}`;
    const response = await fetchWithRetry(url);
    const data = await response.json();

    const result = data.quoteSummary?.result?.[0];
    if (!result) {
      console.error(`[fetchFundamentals] No data for ${normalizedSymbol}`);
      return null;
    }

    const summaryDetail = result.summaryDetail || {};
    const keyStats = result.defaultKeyStatistics || {};
    const profile = result.assetProfile || {};

    const fundamentalsResult: FundamentalsResult = {
      symbol: normalizedSymbol,
      marketCap: summaryDetail.marketCap?.raw ?? null,
      peRatio: summaryDetail.trailingPE?.raw ?? null,
      eps: keyStats.trailingEps?.raw ?? null,
      dividendYield: summaryDetail.dividendYield?.raw ?? null,
      beta: keyStats.beta?.raw ?? null,
      week52High: summaryDetail.fiftyTwoWeekHigh?.raw ?? null,
      week52Low: summaryDetail.fiftyTwoWeekLow?.raw ?? null,
      sector: profile.sector ?? null,
      industry: profile.industry ?? null,
    };

    // Cache the result
    if (cache) {
      await cache.set(cacheKey, fundamentalsResult, CACHE_TTL.FUNDAMENTALS);
    }

    console.log(`[fetchFundamentals] Successfully fetched fundamentals for ${normalizedSymbol}`);
    return fundamentalsResult;
  } catch (error) {
    console.error(`[fetchFundamentals] Failed to fetch fundamentals for ${normalizedSymbol}:`, error.message);
    return null;
  }
}
