// Stock Data Client - Multi-source data aggregation for TradeLens AI
// Sources: Finnhub (primary), FMP (fallback), Yahoo (charts only)
// Caching: stock_data_cache table with TTL-based expiration

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ==================== TYPES ====================

export interface ChartCandle {
  time: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartResult {
  ticker: string;
  range: string; // "1d", "5d", "1mo", ...
  interval: string; // "1m", "5m", "1d", ...
  candles: ChartCandle[];
  timezone?: string;
}

export interface Fundamentals {
  ticker: string;
  source: "finnhub" | "fmp" | "hybrid";
  currency?: string;
  marketCap?: number;
  peRatio?: number;
  eps?: number;
  dividendYield?: number;
  beta?: number;
  revenuePerShare?: number;
  bookValuePerShare?: number;
  freeCashFlowPerShare?: number;
  profitMargin?: number;
  operatingMargin?: number;
  returnOnEquity?: number;
  sharesOutstanding?: number; // NEW: shares outstanding (in millions)
  updatedAt: string;
}

export interface CompanyProfile {
  ticker: string;
  source: "finnhub" | "fmp";
  name?: string;
  exchange?: string;
  country?: string;
  ipoDate?: string;
  sector?: string;
  industry?: string;
  website?: string;
  description?: string;
  logoUrl?: string;
}

export interface KeyStats {
  ticker: string;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  volume?: number;
  avgVolume?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
}

export interface AnalystInsights {
  ticker: string;
  ratingBuy?: number;
  ratingHold?: number;
  ratingSell?: number;
  targetHigh?: number;
  targetLow?: number;
  targetMean?: number;
  targetMedian?: number;
  updatedAt: string;
}

// ==================== HELPERS ====================

export function safeNumber(val: any): number | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// ==================== CACHING ====================

async function getCached(key: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from("stock_data_cache")
      .select("payload, created_at, ttl_seconds")
      .eq("cache_key", key)
      .maybeSingle();

    if (!data || error) return null;

    const age = (Date.now() - new Date(data.created_at).getTime()) / 1000;
    if (age > data.ttl_seconds) {
      // Expired - best-effort cleanup
      await supabase.from("stock_data_cache").delete().eq("cache_key", key);
      return null;
    }

    return data.payload;
  } catch (err) {
    console.error(`Cache read error for ${key}:`, err);
    return null;
  }
}

async function setCached(
  key: string,
  payload: any,
  ttlSeconds: number,
  source: string
) {
  try {
    await supabase.from("stock_data_cache").upsert({
      cache_key: key,
      payload,
      ttl_seconds: ttlSeconds,
      source,
    });
  } catch (err) {
    console.error(`Cache write error for ${key}:`, err);
    // Non-fatal - continue without caching
  }
}

// ==================== YAHOO FINANCE (CHARTS ONLY) ====================

const yahooHeaders = {
  "User-Agent":
    Deno.env.get("YAHOO_USER_AGENT") ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

async function yahooFetch(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: yahooHeaders });
      if (res.ok) return await res.json();
      if (res.status === 429) {
        // Rate limited - wait and retry
        await new Promise((r) => setTimeout(r, 1000 + i * 1000));
        continue;
      }
      throw new Error(`Yahoo API error: ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 + i * 300));
    }
  }
  throw new Error("Yahoo chart unavailable after retries");
}

export async function getChart(
  ticker: string,
  range: string = "1mo",
  interval: string = "1d"
): Promise<ChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`;

  const data = await yahooFetch(url);
  const quote = data.chart.result[0];
  const meta = quote.meta;
  const indicators = quote.indicators.quote[0];
  const timestamps = quote.timestamp;

  const candles: ChartCandle[] = timestamps
    .map((time: number, idx: number) => ({
      time: time * 1000, // Convert to ms
      open: safeNumber(indicators.open[idx]) ?? 0,
      high: safeNumber(indicators.high[idx]) ?? 0,
      low: safeNumber(indicators.low[idx]) ?? 0,
      close: safeNumber(indicators.close[idx]) ?? 0,
      volume: safeNumber(indicators.volume[idx]) ?? 0,
    }))
    .filter(
      (c: ChartCandle) =>
        c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0
    );

  return {
    ticker: ticker.toUpperCase(),
    range,
    interval,
    candles,
    timezone: meta.exchangeTimezoneName,
  };
}

// ==================== FINNHUB (PRIMARY) ====================

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");

async function finnhubFetch(url: string): Promise<any> {
  if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not configured");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub API error: ${res.status}`);
  }
  return await res.json();
}

async function getFundamentalsFromFinnhub(
  ticker: string
): Promise<Fundamentals> {
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`;
  const data = await finnhubFetch(url);
  const metric = data.metric || {};

  // Shares outstanding not in metric API, try profile
  let sharesOutstanding: number | undefined;
  try {
    const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`;
    const profile = await finnhubFetch(profileUrl);
    // Finnhub returns shares outstanding in raw count, convert to millions
    sharesOutstanding = profile.shareOutstanding 
      ? safeNumber(profile.shareOutstanding) 
      : undefined;
  } catch (_err) {
    // Ignore if profile fetch fails
  }

  return {
    ticker: ticker.toUpperCase(),
    source: "finnhub",
    currency: "USD",
    marketCap: safeNumber(metric.marketCapitalization),
    peRatio: safeNumber(metric.peTTM),
    eps: safeNumber(metric.epsTTM),
    dividendYield: safeNumber(metric.dividendYieldIndicatedAnnual),
    beta: safeNumber(metric.beta),
    revenuePerShare: safeNumber(metric.revenuePerShareTTM),
    bookValuePerShare: safeNumber(metric.bookValuePerShareAnnual),
    freeCashFlowPerShare: safeNumber(metric.freeCashFlowPerShareTTM),
    profitMargin: safeNumber(metric.netMargin),
    operatingMargin: safeNumber(metric.operatingMargin),
    returnOnEquity: safeNumber(metric.roeTTM),
    sharesOutstanding: sharesOutstanding,
    updatedAt: new Date().toISOString(),
  };
}

async function getCompanyProfileFromFinnhub(
  ticker: string
): Promise<CompanyProfile> {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`;
  const data = await finnhubFetch(url);

  return {
    ticker: ticker.toUpperCase(),
    source: "finnhub",
    name: data.name,
    exchange: data.exchange,
    country: data.country,
    ipoDate: data.ipo,
    sector: data.finnhubIndustry,
    industry: data.finnhubIndustry,
    website: data.weburl,
    description: data.description,
    logoUrl: data.logo,
  };
}

async function getAnalystFromFinnhub(
  ticker: string
): Promise<AnalystInsights> {
  // Fetch recommendation trends
  const recUrl = `https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`;
  const recData = await finnhubFetch(recUrl);

  // Fetch price targets
  const targetUrl = `https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${FINNHUB_KEY}`;
  const targetData = await finnhubFetch(targetUrl);

  // Get latest recommendation
  const latest = recData[0] || {};

  return {
    ticker: ticker.toUpperCase(),
    ratingBuy: safeNumber(latest.buy),
    ratingHold: safeNumber(latest.hold),
    ratingSell: safeNumber(latest.sell),
    targetHigh: safeNumber(targetData.targetHigh),
    targetLow: safeNumber(targetData.targetLow),
    targetMean: safeNumber(targetData.targetMean),
    targetMedian: safeNumber(targetData.targetMedian),
    updatedAt: new Date().toISOString(),
  };
}

// ==================== FMP (FALLBACK) ====================

const FMP_KEY = Deno.env.get("FMP_API_KEY");

async function fmpFetch(url: string): Promise<any> {
  if (!FMP_KEY) throw new Error("FMP_API_KEY not configured");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP API error: ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function getFundamentalsFromFmp(ticker: string): Promise<Fundamentals> {
  // Fetch key metrics
  const metricsUrl = `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${FMP_KEY}`;
  const metrics = await fmpFetch(metricsUrl);

  // Fetch ratios
  const ratiosUrl = `https://financialmodelingprep.com/api/v3/ratios-ttm/${ticker}?apikey=${FMP_KEY}`;
  const ratios = await fmpFetch(ratiosUrl);

  // Fetch profile for shares outstanding (FMP doesn't have it in metrics)
  let sharesOutstanding: number | undefined;
  try {
    const profileUrl = `https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${FMP_KEY}`;
    const profile = await fmpFetch(profileUrl);
    // FMP returns shares outstanding as a raw number, convert to millions
    sharesOutstanding = profile.sharesOutstanding 
      ? safeNumber(profile.sharesOutstanding) / 1000000 
      : undefined;
  } catch (_err) {
    // Ignore if profile fetch fails
  }

  return {
    ticker: ticker.toUpperCase(),
    source: "fmp",
    currency: "USD",
    marketCap: safeNumber(metrics.marketCapTTM),
    peRatio: safeNumber(ratios.priceEarningsRatioTTM),
    eps: safeNumber(metrics.netIncomePerShareTTM),
    dividendYield: safeNumber(ratios.dividendYieldTTM),
    beta: safeNumber(metrics.betaTTM),
    revenuePerShare: safeNumber(metrics.revenuePerShareTTM),
    bookValuePerShare: safeNumber(metrics.bookValuePerShareTTM),
    freeCashFlowPerShare: safeNumber(metrics.freeCashFlowPerShareTTM),
    profitMargin: safeNumber(ratios.netProfitMarginTTM),
    operatingMargin: safeNumber(ratios.operatingProfitMarginTTM),
    returnOnEquity: safeNumber(ratios.returnOnEquityTTM),
    sharesOutstanding: sharesOutstanding,
    updatedAt: new Date().toISOString(),
  };
}

async function getCompanyProfileFromFmp(ticker: string): Promise<CompanyProfile> {
  const url = `https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${FMP_KEY}`;
  const data = await fmpFetch(url);

  return {
    ticker: ticker.toUpperCase(),
    source: "fmp",
    name: data.companyName,
    exchange: data.exchangeShortName,
    country: data.country,
    ipoDate: data.ipoDate,
    sector: data.sector,
    industry: data.industry,
    website: data.website,
    description: data.description,
    logoUrl: data.image,
  };
}

// ==================== PUBLIC API ====================

export async function getFundamentals(ticker: string): Promise<Fundamentals> {
  const cacheKey = `v2:fundamentals:${ticker.toUpperCase()}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached as Fundamentals;

  // Try Finnhub first
  let fundamentals: Fundamentals;
  try {
    fundamentals = await getFundamentalsFromFinnhub(ticker);
  } catch (err) {
    console.error("Finnhub fundamentals failed:", err);
    // Fallback to FMP
    fundamentals = await getFundamentalsFromFmp(ticker);
  }

  // Check if we need enrichment (missing critical fields)
  const needsEnrichment =
    !fundamentals.marketCap || !fundamentals.peRatio || !fundamentals.eps;

  if (needsEnrichment && fundamentals.source === "finnhub") {
    try {
      const fmp = await getFundamentalsFromFmp(ticker);
      fundamentals = {
        ...fmp,
        ...fundamentals,
        source: "hybrid",
        updatedAt: new Date().toISOString(),
      };
    } catch (_err) {
      // Ignore enrichment failure
    }
  }

  const ttl = parseInt(Deno.env.get("STOCK_CACHE_TTL_SECONDS") ?? "3600");
  await setCached(cacheKey, fundamentals, ttl, fundamentals.source);
  return fundamentals;
}

export async function getCompanyProfile(
  ticker: string
): Promise<CompanyProfile> {
  const cacheKey = `v2:profile:${ticker.toUpperCase()}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached as CompanyProfile;

  // Try Finnhub first
  let profile: CompanyProfile;
  try {
    profile = await getCompanyProfileFromFinnhub(ticker);
  } catch (err) {
    console.error("Finnhub profile failed:", err);
    // Fallback to FMP
    profile = await getCompanyProfileFromFmp(ticker);
  }

  const ttl = 86400; // 24 hours - profiles rarely change
  await setCached(cacheKey, profile, ttl, profile.source);
  return profile;
}

export async function getKeyStats(ticker: string): Promise<KeyStats> {
  const cacheKey = `v2:keystats:${ticker.toUpperCase()}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached as KeyStats;

  // Use Yahoo chart's latest candle for key stats
  const chartData = await getChart(ticker, "5d", "1d");
  const latestCandle = chartData.candles[chartData.candles.length - 1];

  const stats: KeyStats = {
    ticker: ticker.toUpperCase(),
    open: latestCandle.open,
    high: latestCandle.high,
    low: latestCandle.low,
    prevClose: chartData.candles[chartData.candles.length - 2]?.close,
    volume: latestCandle.volume,
    // Try to get 52-week range from Finnhub if available
  };

  // Enrich with Finnhub quote if available
  try {
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`;
    const quote = await finnhubFetch(quoteUrl);
    stats.fiftyTwoWeekHigh = safeNumber(quote["52WeekHigh"]);
    stats.fiftyTwoWeekLow = safeNumber(quote["52WeekLow"]);
  } catch (_err) {
    // Ignore if Finnhub fails
  }

  const ttl = 900; // 15 minutes
  await setCached(cacheKey, stats, ttl, "hybrid");
  return stats;
}

export async function getAnalystInsights(
  ticker: string
): Promise<AnalystInsights> {
  const cacheKey = `v2:analyst:${ticker.toUpperCase()}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached as AnalystInsights;

  const insights = await getAnalystFromFinnhub(ticker);

  const ttl = 3600; // 1 hour
  await setCached(cacheKey, insights, ttl, "finnhub");
  return insights;
}
