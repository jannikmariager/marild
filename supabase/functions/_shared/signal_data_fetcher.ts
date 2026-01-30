/**
 * Signal Data Fetcher - Cache-First OHLC Strategy
 * 
 * DATA SOURCE PRIORITY (Live Signals):
 * 1. Supabase ohlc-cache (primary) - Pre-cached historical data
 * 2. Yahoo V8 (fallback) - Fetch missing/recent bars and append to cache
 * 3. NO POLYGON - Polygon was used for historical backfill only (too expensive for live)
 * 
 * Assembles real market data from multiple sources:
 * - Supabase OHLC Cache + Yahoo Finance (OHLCV)
 * - Yahoo Finance (quotes, news)
 * - Finnhub (fundamentals, analyst data)
 * - FMP (fallback for fundamentals)
 * - SMC Database (order blocks, BOS events, sessions)
 * 
 * Outputs: RawSignalInput ready for scoring and AI evaluation
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { fetchChart, fetchQuote, fetchNews as fetchYahooNews } from "./yahoo_v8_client.ts";
import { fetchNewsSentiment, type NewsSentimentSummary } from "./signal_news_sentiment.ts";
import {
  OHLCBar,
  QuoteData,
  FundamentalsData,
  AnalystData,
  NewsItem,
  SMCData,
  OrderBlock,
  BOSEvent,
  SessionRange,
  VolumeMetrics,
  RawSignalInput,
  normalizeTimeframe,
} from "./signal_types.ts";
import { loadMassiveOHLC, type SupportedTimeframe } from "./ohlc_loader.ts";
import {
  getRealtimeQuote,
  fetchAlpacaSnapshots,
  upsertRealtimeQuotes,
  type AlpacaQuote,
} from "./alpaca_market_data.ts";
import { recordMarketDataEvent, type MarketDataType } from "./market_data_diagnostics.ts";
import { postAdminAlert, AlertSeverity } from "../_admin_shared/admin_alerts.ts";

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const REALTIME_MAX_AGE_MS = Number(Deno.env.get("REALTIME_MAX_AGE_MS") ?? "90000");
const QUOTE_STALENESS_ALERT_SECONDS = Number(
  Deno.env.get("QUOTE_STALENESS_ALERT_SECONDS") ?? "600",
);
const OHLC_STALENESS_ALERT_SECONDS = Number(
  Deno.env.get("OHLC_STALENESS_ALERT_SECONDS") ?? "1800",
);

// ============================================================
// 1. OHLC CACHE HELPERS
// ============================================================

/**
 * Fetch OHLC data via unified loader (Massive historical + Yahoo incremental)
 */
async function fetchOHLCFromCache(
  symbol: string,
  timeframe: string
): Promise<OHLCBar[]> {
  const normalizedTf = normalizeTimeframe(timeframe) as SupportedTimeframe;
  return await loadMassiveOHLC(symbol, normalizedTf);
}

function mapRealtimeQuote(symbol: string, quote: {
  bidPrice?: number | null;
  askPrice?: number | null;
  lastPrice?: number | null;
  mid?: number | null;
  dayVolume?: number | null;
}): QuoteData | null {
  const price = quote.mid ?? quote.lastPrice ?? quote.bidPrice ?? quote.askPrice ?? null;
  if (price == null || price <= 0) {
    return null;
  }

  return {
    ticker: symbol,
    current_price: price,
    change: 0,
    change_percent: 0,
    volume: quote.dayVolume ?? 0,
    avg_volume: null,
    market_cap: null,
    day_high: null,
    day_low: null,
    week_52_high: null,
    week_52_low: null,
    previous_close: null,
  };
}

function computeStalenessSeconds(timestampIso?: string | null, referenceMs = Date.now()): number | null {
  if (!timestampIso) return null;
  const ts = Date.parse(timestampIso);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((referenceMs - ts) / 1000));
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}
async function alertStalenessIfNeeded(
  params: {
    symbol: string;
    dataType: MarketDataType;
    stalenessSeconds: number | null;
    thresholdSeconds: number;
    source: string;
    context: string;
  },
): Promise<void> {
  const { symbol, dataType, stalenessSeconds, thresholdSeconds, source, context } = params;
  if (stalenessSeconds == null || stalenessSeconds < thresholdSeconds) {
    return;
  }
  const severity =
    stalenessSeconds > thresholdSeconds * 2 ? AlertSeverity.ERROR : AlertSeverity.WARNING;
  await postAdminAlert({
    severity,
    function_name: context,
    error_message: `${dataType} staleness ${stalenessSeconds}s for ${symbol}`,
    details: `Source=${source}, threshold=${thresholdSeconds}s`,
    fallback_action: 'Check market data ingestion / Alpaca stream',
  });
}

async function fetchFreshAlpacaQuote(symbol: string): Promise<{ quote: QuoteData; raw: AlpacaQuote } | null> {
  try {
    const normalized = normalizeSymbol(symbol);
    const snapshots = await fetchAlpacaSnapshots([normalized], 1);
    const raw = snapshots[normalized];
    if (!raw) {
      return null;
    }
    await upsertRealtimeQuotes(supabase, [raw]);
    const mapped = mapRealtimeQuote(normalized, raw);
    if (!mapped) {
      return null;
    }
    return { quote: mapped, raw };
  } catch (error) {
    console.warn(`[fetchFreshAlpacaQuote] Failed for ${symbol}:`, error);
    return null;
  }
}




/**
 * Fetch OHLC data via unified loader.
 * 
 * The unified loader handles:
 * - Massive historical base
 * - Yahoo V8 incremental updates (for 5m/15m/30m/1h/1d)
 * - Automatic cache merging and write-back
 */
export async function fetchOHLCDataWithCache(
  symbol: string,
  timeframe: string,
  engineType: string,
  minBars: number = 100,
): Promise<{ bars: OHLCBar[]; source: "unified" }> {
  const bars = await fetchOHLCFromCache(symbol, timeframe);

  if (bars.length < minBars) {
    throw new Error(
      `[fetchOHLCDataWithCache] Insufficient OHLC bars for ${symbol}/${timeframe}: got ${bars.length}, expected at least ${minBars}`,
    );
  }
  const latestBar = bars[bars.length - 1];
  const barTimestamp =
    latestBar?.timestamp ??
    (latestBar?.date ? new Date(latestBar.date).toISOString() : null);
  const ohlcStaleness = computeStalenessSeconds(barTimestamp);
  await recordMarketDataEvent(supabase, {
    symbol,
    dataType: 'OHLC',
    source: 'UNIFIED_CACHE',
    provider: 'SUPABASE+YAHOO',
    dataTimestamp: barTimestamp,
    stalenessSeconds: ohlcStaleness,
    context: `fetchOHLCDataWithCache:${engineType}`,
    metadata: {
      timeframe,
      bar_count: bars.length,
    },
  });
  await alertStalenessIfNeeded({
    symbol,
    dataType: 'OHLC',
    stalenessSeconds: ohlcStaleness,
    thresholdSeconds: OHLC_STALENESS_ALERT_SECONDS,
    source: 'UNIFIED_CACHE',
    context: `fetchOHLCDataWithCache:${engineType}`,
  });

  return { bars, source: "unified" };
}

// ============================================================
// 2. LEGACY FUNCTION (Kept for backward compatibility)
// ============================================================

/**
 * Legacy Yahoo OHLC fetcher (no longer used by core pipelines).
 * Left in place temporarily for any ad-hoc tooling; prefer
 * loadMassiveOHLC + ohlc-cache-v2 for all new code.
 */
export async function fetchOHLCData(
  symbol: string,
  timeframe: string
): Promise<OHLCBar[]> {
  return fetchOHLCFromCache(symbol, timeframe);
}

// ============================================================
// 2. FETCH CURRENT QUOTE
// ============================================================

/**
 * Fetch real-time quote data from Yahoo Finance
 * Fallback: Use latest OHLC bar's close price if Yahoo API fails
 */
export async function fetchCurrentQuote(symbol: string): Promise<QuoteData> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const fetchedAt = new Date();
  try {
    const realtime = await getRealtimeQuote(supabase, normalizedSymbol, REALTIME_MAX_AGE_MS);
    if (realtime) {
      const mapped = mapRealtimeQuote(normalizedSymbol, realtime);
      if (mapped) {
        const staleness = computeStalenessSeconds(realtime.lastTimestamp ?? null, fetchedAt.getTime());
        await recordMarketDataEvent(supabase, {
          symbol: normalizedSymbol,
          dataType: 'QUOTE',
          source: 'ALPACA_REALTIME_CACHE',
          provider: 'ALPACA',
          dataTimestamp: realtime.lastTimestamp ?? null,
          stalenessSeconds: staleness,
          context: 'fetchCurrentQuote',
          metadata: { path: 'cache_hit' },
        });
        await alertStalenessIfNeeded({
          symbol: normalizedSymbol,
          dataType: 'QUOTE',
          stalenessSeconds: staleness,
          thresholdSeconds: QUOTE_STALENESS_ALERT_SECONDS,
          source: 'ALPACA_REALTIME_CACHE',
          context: 'fetchCurrentQuote',
        });
        console.log(`[fetchCurrentQuote] ${normalizedSymbol}: $${mapped.current_price} (alpaca cache)`);
        return mapped;
      }
    }

    const freshAlpaca = await fetchFreshAlpacaQuote(normalizedSymbol);
    if (freshAlpaca) {
      const staleness = computeStalenessSeconds(freshAlpaca.raw.lastTimestamp ?? null, fetchedAt.getTime());
      await recordMarketDataEvent(supabase, {
        symbol: normalizedSymbol,
        dataType: 'QUOTE',
        source: 'ALPACA_SNAPSHOT',
        provider: 'ALPACA',
        dataTimestamp: freshAlpaca.raw.lastTimestamp ?? null,
        stalenessSeconds: staleness,
        context: 'fetchCurrentQuote',
        metadata: { path: 'direct_snapshot' },
      });
      await alertStalenessIfNeeded({
        symbol: normalizedSymbol,
        dataType: 'QUOTE',
        stalenessSeconds: staleness,
        thresholdSeconds: QUOTE_STALENESS_ALERT_SECONDS,
        source: 'ALPACA_SNAPSHOT',
        context: 'fetchCurrentQuote',
      });
      console.log(`[fetchCurrentQuote] ${normalizedSymbol}: $${freshAlpaca.quote.current_price} (alpaca snapshot)`);
      return freshAlpaca.quote;
    }

    console.warn(`[fetchCurrentQuote] Alpaca unavailable for ${normalizedSymbol}, falling back to Yahoo`);
    const quoteResult = await fetchQuote(normalizedSymbol);

    if (!quoteResult || quoteResult.price === null) {
      // Fallback: Use OHLC data to construct a quote
      console.warn(`[fetchCurrentQuote] Yahoo API returned null for ${normalizedSymbol}, falling back to OHLC data`);
      try {
        const ohlcData = await fetchOHLCFromCache(normalizedSymbol, '1h');
        if (ohlcData && ohlcData.length > 0) {
          const lastBar = ohlcData[ohlcData.length - 1];
          const quote: QuoteData = {
            ticker: normalizedSymbol,
            current_price: lastBar.close,
            change: 0, // Can't compute without previous close
            change_percent: 0,
            volume: lastBar.volume,
            avg_volume: null,
            market_cap: null,
            day_high: lastBar.high,
            day_low: lastBar.low,
            week_52_high: null,
            week_52_low: null,
            previous_close: null,
          };
          await recordMarketDataEvent(supabase, {
            symbol: normalizedSymbol,
            dataType: 'QUOTE',
            source: 'OHLC_FALLBACK',
            provider: 'SUPABASE_CACHE',
            dataTimestamp: lastBar.timestamp ?? null,
            stalenessSeconds: computeStalenessSeconds(lastBar.timestamp ?? null, fetchedAt.getTime()),
            context: 'fetchCurrentQuote',
            metadata: { path: 'ohlc_fallback', timeframe: '1h' },
          });
          await alertStalenessIfNeeded({
            symbol: normalizedSymbol,
            dataType: 'QUOTE',
            stalenessSeconds: computeStalenessSeconds(
              lastBar.timestamp ?? null,
              fetchedAt.getTime(),
            ),
            thresholdSeconds: QUOTE_STALENESS_ALERT_SECONDS,
            source: 'OHLC_FALLBACK',
            context: 'fetchCurrentQuote',
          });
          console.log(`[fetchCurrentQuote] ${normalizedSymbol}: $${quote.current_price} (from OHLC fallback)`);
          return quote;
        }
      } catch (fallbackErr) {
        console.error(`[fetchCurrentQuote] OHLC fallback failed for ${normalizedSymbol}:`, fallbackErr);
      }
      throw new Error(`No quote data for ${normalizedSymbol}`);
    }

    const quote: QuoteData = {
      ticker: normalizedSymbol,
      current_price: quoteResult.price ?? 0,
      change: quoteResult.change ?? 0,
      change_percent: quoteResult.changePercent ?? 0,
      volume: quoteResult.volume ?? 0,
      avg_volume: null, // Not available in v8 quote API
      market_cap: null, // Not available in v8 quote API
      day_high: quoteResult.dayHigh ?? null,
      day_low: quoteResult.dayLow ?? null,
      week_52_high: quoteResult.fiftyTwoWeekHigh ?? null,
      week_52_low: quoteResult.fiftyTwoWeekLow ?? null,
      previous_close: quoteResult.previousClose ?? null,
    };
    await recordMarketDataEvent(supabase, {
      symbol: normalizedSymbol,
      dataType: 'QUOTE',
      source: 'YAHOO_V8',
      provider: 'YAHOO',
      dataTimestamp: new Date().toISOString(),
      stalenessSeconds: 0,
      context: 'fetchCurrentQuote',
      metadata: { path: 'yahoo_fallback' },
    });

    // GUARDRAIL: Validate price is reasonable
    if (quote.current_price <= 0) {
      throw new Error(`Invalid price for ${symbol}: $${quote.current_price}`);
    }

    // GUARDRAIL: Check if price deviates too much from 52-week range (possible stale data)
    if (quote.week_52_high && quote.week_52_low) {
      const range52w = quote.week_52_high - quote.week_52_low;
      const midpoint = (quote.week_52_high + quote.week_52_low) / 2;
      const deviation = Math.abs(quote.current_price - midpoint) / midpoint;
      
      // If current price is more than 50% away from 52w range midpoint, log warning
      if (deviation > 0.5) {
        console.warn(`[fetchCurrentQuote] PRICE ANOMALY: ${symbol} at $${quote.current_price} vs 52w range $${quote.week_52_low}-$${quote.week_52_high}`);
      }
    }

    // GUARDRAIL: Validate price against previous close (detect stale data)
    if (quote.previous_close && quote.previous_close > 0) {
      const changeFromPrevClose = Math.abs(quote.current_price - quote.previous_close) / quote.previous_close;
      
      // If price changed more than 50% from previous close, likely stale/wrong data
      if (changeFromPrevClose > 0.5) {
        throw new Error(
          `STALE DATA DETECTED: ${symbol} price $${quote.current_price} vs previous close $${quote.previous_close} (${(changeFromPrevClose * 100).toFixed(1)}% change)`
        );
      }
    }

    console.log(`[fetchCurrentQuote] ${symbol}: $${quote.current_price}`);
    return quote;
  } catch (error) {
    console.error(`[fetchCurrentQuote] Error fetching ${symbol}:`, error);
    throw new Error(`Failed to fetch quote for ${symbol}: ${error.message}`);
  }
}

// ============================================================
// 3. FETCH FUNDAMENTALS (Finnhub Primary, FMP Fallback)
// ============================================================

/**
 * Fetch fundamental data from Finnhub (primary) or FMP (fallback)
 */
export async function fetchFundamentals(
  symbol: string
): Promise<FundamentalsData> {
  const finnhubKey = Deno.env.get("FINNHUB_API_KEY");
  const fmpKey = Deno.env.get("FMP_API_KEY");

  // Try Finnhub first
  if (finnhubKey) {
    try {
      console.log(`[fetchFundamentals] Trying Finnhub for ${symbol}`);
      const response = await fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${finnhubKey}`
      );

      if (response.ok) {
        const data = await response.json();
        const metrics = data.metric;

        if (metrics) {
          const fundamentals: FundamentalsData = {
            ticker: symbol,
            market_cap: metrics.marketCapitalization,
            pe_ratio: metrics.peBasicExclExtraTTM || metrics.peNormalizedAnnual,
            eps: metrics.epsBasicExclExtraItemsTTM,
            dividend_yield: metrics.dividendYieldIndicatedAnnual,
            beta: metrics.beta,
            revenue_per_share: metrics.revenuePerShareTTM,
            book_value_per_share: metrics.bookValuePerShareAnnual,
            profit_margin: metrics.netProfitMarginTTM,
            return_on_equity: metrics.roeTTM,
            shares_outstanding: metrics.sharesOutstanding,
          };

          console.log(`[fetchFundamentals] Finnhub success for ${symbol}`);
          return fundamentals;
        }
      }
    } catch (error) {
      console.warn(`[fetchFundamentals] Finnhub failed for ${symbol}:`, error.message);
    }
  }

  // Try FMP as fallback
  if (fmpKey) {
    try {
      console.log(`[fetchFundamentals] Trying FMP for ${symbol}`);
      const response = await fetch(
        `https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${symbol}&apikey=${fmpKey}`
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const metrics = data[0];

          const fundamentals: FundamentalsData = {
            ticker: symbol,
            market_cap: metrics.marketCapTTM,
            pe_ratio: metrics.peRatioTTM,
            eps: metrics.netIncomePerShareTTM,
            dividend_yield: metrics.dividendYieldTTM,
            beta: metrics.betaTTM,
            revenue_per_share: metrics.revenuePerShareTTM,
            book_value_per_share: metrics.bookValuePerShareTTM,
            profit_margin: metrics.netProfitMarginTTM,
            return_on_equity: metrics.roeTTM,
            shares_outstanding: metrics.sharesOutstandingTTM,
          };

          console.log(`[fetchFundamentals] FMP success for ${symbol}`);
          return fundamentals;
        }
      }
    } catch (error) {
      console.warn(`[fetchFundamentals] FMP failed for ${symbol}:`, error.message);
    }
  }

  // Both failed - return partial data
  console.warn(`[fetchFundamentals] All sources failed for ${symbol}, returning partial data`);
  return {
    ticker: symbol,
  };
}

// ============================================================
// 4. FETCH ANALYST DATA (Finnhub Only)
// ============================================================

/**
 * Fetch analyst ratings and price targets from Finnhub
 */
export async function fetchAnalystData(
  symbol: string
): Promise<AnalystData | null> {
  const finnhubKey = Deno.env.get("FINNHUB_API_KEY");

  if (!finnhubKey) {
    console.log(`[fetchAnalystData] No Finnhub key, skipping ${symbol}`);
    return null;
  }

  try {
    console.log(`[fetchAnalystData] Fetching for ${symbol}`);
    
    const [recommendationRes, targetRes] = await Promise.all([
      fetch(
        `https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${finnhubKey}`
      ),
      fetch(
        `https://finnhub.io/api/v1/stock/price-target?symbol=${symbol}&token=${finnhubKey}`
      ),
    ]);

    let analystData: AnalystData = {
      ticker: symbol,
      updated_at: new Date().toISOString(),
    };

    // Parse recommendations
    if (recommendationRes.ok) {
      const recommendations = await recommendationRes.json();
      if (recommendations && recommendations.length > 0) {
        const latest = recommendations[0];
        analystData.rating_buy = latest.buy || 0;
        analystData.rating_hold = latest.hold || 0;
        analystData.rating_sell = latest.sell || 0;
      }
    }

    // Parse price targets
    if (targetRes.ok) {
      const targets = await targetRes.json();
      if (targets) {
        analystData.target_high = targets.targetHigh;
        analystData.target_low = targets.targetLow;
        analystData.target_mean = targets.targetMean;
        analystData.target_median = targets.targetMedian;
      }
    }

    console.log(`[fetchAnalystData] Success for ${symbol}`);
    return analystData;
  } catch (error) {
    console.warn(`[fetchAnalystData] Error for ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// 5. FETCH NEWS (Yahoo Finance with Sentiment)
// ============================================================

/**
 * Fetch recent news articles with basic sentiment analysis
 */
export async function fetchNews(
  symbol: string,
  lookbackHours: number = 48
): Promise<NewsItem[]> {
  try {
    console.log(`[fetchNews] Fetching news for ${symbol} (last ${lookbackHours}h)`);
    
    const yahooNewsItems = await fetchYahooNews(symbol, 20);

    const cutoffTime = Date.now() - lookbackHours * 60 * 60 * 1000;

    const articles: NewsItem[] = yahooNewsItems
      .filter((item) => {
        const publishedTime = new Date(item.publishedAt).getTime();
        return publishedTime >= cutoffTime;
      })
      .map((item) => {
        const text = `${item.title} ${item.summary || ""}`;
        const sentiment = analyzeSentiment(text);

        return {
          id: item.url || String(Math.random()),
          headline: item.title,
          summary: item.summary,
          content: null,
          source: item.source || "Yahoo Finance",
          author: null,
          published_at: item.publishedAt,
          image_url: null,
          url: item.url,
          sentiment: sentiment,
        };
      });

    console.log(`[fetchNews] Found ${articles.length} recent articles for ${symbol}`);
    return articles;
  } catch (error) {
    console.error(`[fetchNews] Error fetching ${symbol}:`, error);
    return []; // Non-critical - return empty array
  }
}

/**
 * Basic keyword-based sentiment analysis
 */
function analyzeSentiment(text: string): "bullish" | "neutral" | "bearish" {
  const lower = text.toLowerCase();

  const bullishWords = [
    "surge",
    "soar",
    "rally",
    "gain",
    "bull",
    "upgrade",
    "beat",
    "growth",
    "profit",
    "strong",
    "rise",
    "jump",
    "higher",
    "outperform",
  ];
  const bearishWords = [
    "crash",
    "plunge",
    "fall",
    "drop",
    "bear",
    "downgrade",
    "miss",
    "loss",
    "weak",
    "decline",
    "sink",
    "tumble",
    "lower",
    "underperform",
  ];

  let bullishCount = 0;
  let bearishCount = 0;

  bullishWords.forEach((word) => {
    if (lower.includes(word)) bullishCount++;
  });

  bearishWords.forEach((word) => {
    if (lower.includes(word)) bearishCount++;
  });

  if (bullishCount > bearishCount) return "bullish";
  if (bearishCount > bullishCount) return "bearish";
  return "neutral";
}

// ============================================================
// 6. FETCH SMC DATA (Database)
// ============================================================

/**
 * Fetch SMC data (order blocks, BOS events, sessions) from database
 */
export async function fetchSMCData(
  symbol: string,
  timeframe: string
): Promise<SMCData> {
  const normalizedTf = normalizeTimeframe(timeframe);

  try {
    console.log(`[fetchSMCData] Fetching SMC data for ${symbol} ${normalizedTf}`);

    const [obResult, bosResult, sessionResult] = await Promise.all([
      supabase
        .from("smc_order_blocks")
        .select("*")
        .eq("ticker", symbol)
        .eq("timeframe", normalizedTf)
        .order("created_at", { ascending: false })
        .limit(20),
      
      supabase
        .from("smc_bos_events")
        .select("*")
        .eq("ticker", symbol)
        .eq("timeframe", normalizedTf)
        .order("event_time", { ascending: false })
        .limit(10),
      
      supabase
        .from("smc_session_ranges")
        .select("*")
        .eq("ticker", symbol)
        .order("session_date", { ascending: false })
        .limit(5),
    ]);

    const orderBlocks: OrderBlock[] = (obResult.data || []).map((row: any) => ({
      id: row.id,
      ticker: row.ticker,
      timeframe: row.timeframe,
      direction: row.direction,
      high: row.high,
      low: row.low,
      open_time: row.open_time,
      close_time: row.close_time,
      mitigated: row.mitigated,
      mitigation_time: row.mitigation_time,
      origin: row.origin,
      created_at: row.created_at,
    }));

    const bosEvents: BOSEvent[] = (bosResult.data || []).map((row: any) => ({
      id: row.id,
      ticker: row.ticker,
      timeframe: row.timeframe,
      direction: row.direction,
      price: row.price,
      event_time: row.event_time,
      strength: row.strength,
      created_at: row.created_at,
    }));

    const sessionRanges: SessionRange[] = (sessionResult.data || []).map(
      (row: any) => ({
        id: row.id,
        ticker: row.ticker,
        session_date: row.session_date,
        session_type: row.session_type,
        high: row.high,
        low: row.low,
        open_time: row.open_time,
        close_time: row.close_time,
        created_at: row.created_at,
      })
    );

    console.log(
      `[fetchSMCData] ${symbol}: ${orderBlocks.length} OBs, ${bosEvents.length} BOS, ${sessionRanges.length} sessions`
    );

    return {
      order_blocks: orderBlocks,
      bos_events: bosEvents,
      session_ranges: sessionRanges,
    };
  } catch (error) {
    console.error(`[fetchSMCData] Error fetching ${symbol}:`, error);
    // Return empty SMC data on error (non-critical)
    return {
      order_blocks: [],
      bos_events: [],
      session_ranges: [],
    };
  }
}

// ============================================================
// 7. ASSEMBLE RAW SIGNAL INPUT
// ============================================================

/**
 * Aggregate all data sources into a complete RawSignalInput
 * 
 * Uses cache-first OHLC strategy:
 * 1. Try Supabase ohlc-cache
 * 2. Fall back to Yahoo V8 if cache is stale
 * 3. Update cache asynchronously
 */
export async function assembleRawSignalInput(
  symbol: string,
  timeframe: string,
  engineType: string = 'SWING' // DAYTRADER, SWING, or INVESTOR
): Promise<RawSignalInput & { news_sentiment?: NewsSentimentSummary }> {
  console.log(`[assembleRawSignalInput] Starting for ${symbol} ${timeframe}`);

  try {
    // Determine time window based on timeframe
    const tf = normalizeTimeframe(timeframe);
    const timeWindowMap: Record<string, number> = {
      "1m": 6,   // very short lookback for ultra-intraday
      "3m": 8,
      "5m": 12,
      "15m": 12,
      "30m": 18,
      "1h": 24,
      "4h": 48,
      "1d": 72,
    };
    const sentimentWindow = timeWindowMap[tf] || 24;

    // Fetch all data in parallel (including news sentiment)
    // IMPORTANT: Using cache-first strategy for OHLC data
    const [ohlcResult, quote, fundamentals, analyst, news, smc, newsSentiment] = await Promise.all([
      fetchOHLCDataWithCache(symbol, timeframe, engineType),
      fetchCurrentQuote(symbol),
      fetchFundamentals(symbol),
      fetchAnalystData(symbol),
      fetchNews(symbol, 48),
      fetchSMCData(symbol, timeframe),
      fetchNewsSentiment(symbol, sentimentWindow),
    ]);
    
    const ohlcv = ohlcResult.bars;
    console.log(`[assembleRawSignalInput] OHLC loaded: ${ohlcv.length} bars (unified Massive+Yahoo loader)`);

    // Calculate volume metrics from OHLCV
    const volumeMetrics = calculateVolumeMetrics(ohlcv);

    // Calculate aggregate sentiment score from news
    const sentimentScore = calculateSentimentScore(news);

    // Generate preliminary rule-based signal (basic heuristic)
    const { signal_type, confidence, smc_conf, vol_conf, sent_conf, confluence } =
      generatePreliminarySignal(smc, volumeMetrics, sentimentScore, quote);

    const rawSignalInput: RawSignalInput & { news_sentiment?: NewsSentimentSummary } = {
      symbol,
      timeframe: normalizeTimeframe(timeframe),
      
      // Market data
      ohlcv,
      quote,
      fundamentals,
      analyst,
      
      // News & sentiment
      news,
      news_sentiment: newsSentiment,
      
      // Technical analysis
      smc,
      volume_metrics: volumeMetrics,
      sentiment_score: sentimentScore,
      
      // Preliminary signal
      raw_signal_type: signal_type,
      raw_confidence: confidence,
      
      // Confidence breakdown
      smc_confidence: smc_conf,
      volume_confidence: vol_conf,
      sentiment_confidence: sent_conf,
      confluence_score: confluence,
      
      // Metadata
      fetched_at: new Date().toISOString(),
    };

    console.log(
      `[assembleRawSignalInput] Complete for ${symbol}: ${signal_type} @ ${confidence}% confidence (news sentiment: ${newsSentiment.overall_bias}, ${newsSentiment.total_articles} articles)`
    );

    return rawSignalInput;
  } catch (error) {
    console.error(`[assembleRawSignalInput] Critical error for ${symbol}:`, error);
    throw new Error(
      `Failed to assemble signal input for ${symbol}: ${error.message}`
    );
  }
}

// ============================================================
// HELPER: CALCULATE VOLUME METRICS
// ============================================================

function calculateVolumeMetrics(bars: OHLCBar[]): VolumeMetrics {
  if (bars.length < 2) {
    return {
      current_volume: 0,
      avg_volume_20d: 0,
      relative_volume: 1.0,
      volume_trend: "stable",
      volume_spike: false,
      order_flow_bias: "neutral",
    };
  }

  const latest = bars[bars.length - 1];
  const lookback = Math.min(20, bars.length - 1);
  const recentBars = bars.slice(-lookback - 1, -1);

  const avgVolume =
    recentBars.reduce((sum, bar) => sum + bar.volume, 0) / recentBars.length;
  const relativeVolume = latest.volume / avgVolume;

  // Determine trend (last 5 bars)
  const last5 = bars.slice(-6, -1);
  const avgLast5 =
    last5.reduce((sum, bar) => sum + bar.volume, 0) / last5.length;
  const prev5 = bars.slice(-11, -6);
  const avgPrev5 =
    prev5.reduce((sum, bar) => sum + bar.volume, 0) / (prev5.length || 1);

  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (avgLast5 > avgPrev5 * 1.1) trend = "increasing";
  else if (avgLast5 < avgPrev5 * 0.9) trend = "decreasing";

  // Order flow bias (bullish if price up + volume up)
  const priceChange = latest.close - latest.open;
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  if (priceChange > 0 && relativeVolume > 1.2) bias = "bullish";
  else if (priceChange < 0 && relativeVolume > 1.2) bias = "bearish";

  return {
    current_volume: latest.volume,
    avg_volume_20d: avgVolume,
    relative_volume: relativeVolume,
    volume_trend: trend,
    volume_spike: relativeVolume > 1.5,
    order_flow_bias: bias,
  };
}

// ============================================================
// HELPER: CALCULATE SENTIMENT SCORE
// ============================================================

function calculateSentimentScore(news: NewsItem[]): number {
  if (news.length === 0) return 0;

  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;

  news.forEach((article) => {
    const ageHours =
      (now - new Date(article.published_at).getTime()) / (1000 * 60 * 60);
    
    // Recency weight: 2x for <24h, 1.5x for 24-48h, 1x for older
    let weight = 1.0;
    if (ageHours < 24) weight = 2.0;
    else if (ageHours < 48) weight = 1.5;

    // Sentiment score: bullish = +50, bearish = -50, neutral = 0
    let score = 0;
    if (article.sentiment === "bullish") score = 50;
    else if (article.sentiment === "bearish") score = -50;

    weightedSum += score * weight;
    totalWeight += weight;
  });

  const avgScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  // Clamp to -100 to 100
  return Math.max(-100, Math.min(100, avgScore));
}

// ============================================================
// HELPER: GENERATE PRELIMINARY SIGNAL
// ============================================================

function generatePreliminarySignal(
  smc: SMCData,
  volume: VolumeMetrics,
  sentiment: number,
  quote: QuoteData
): {
  signal_type: "buy" | "sell" | "neutral";
  confidence: number;
  smc_conf: number;
  vol_conf: number;
  sent_conf: number;
  confluence: number;
} {
  // SMC confidence
  const activeBullishOBs = smc.order_blocks.filter(
    (ob) => ob.direction === "bullish" && !ob.mitigated
  ).length;
  const activeBearishOBs = smc.order_blocks.filter(
    (ob) => ob.direction === "bearish" && !ob.mitigated
  ).length;
  const lastBOS = smc.bos_events[0];

  let smcBias: "bullish" | "bearish" | "neutral" = "neutral";
  let smcConf = 50;

  if (lastBOS) {
    if (lastBOS.direction === "up") {
      smcBias = "bullish";
      smcConf = 60 + lastBOS.strength * 0.2;
    } else {
      smcBias = "bearish";
      smcConf = 60 + lastBOS.strength * 0.2;
    }
  }

  if (activeBullishOBs > activeBearishOBs) {
    smcBias = "bullish";
    smcConf += 10;
  } else if (activeBearishOBs > activeBullishOBs) {
    smcBias = "bearish";
    smcConf += 10;
  }

  smcConf = Math.min(smcConf, 85);

  // Volume confidence
  let volConf = 50;
  if (volume.volume_spike) volConf += 20;
  if (volume.volume_trend === "increasing") volConf += 10;
  else if (volume.volume_trend === "decreasing") volConf -= 10;
  volConf = Math.max(30, Math.min(volConf, 85));

  // Sentiment confidence
  const sentConf = 50 + Math.abs(sentiment) * 0.3; // 0-100 scale

  // Confluence: how aligned are the signals?
  let signal: "buy" | "sell" | "neutral" = "neutral";
  let confluence = 50;

  const bullishFactors =
    (smcBias === "bullish" ? 1 : 0) +
    (volume.order_flow_bias === "bullish" ? 1 : 0) +
    (sentiment > 20 ? 1 : 0);
  
  const bearishFactors =
    (smcBias === "bearish" ? 1 : 0) +
    (volume.order_flow_bias === "bearish" ? 1 : 0) +
    (sentiment < -20 ? 1 : 0);

  if (bullishFactors >= 2) {
    signal = "buy";
    confluence = 60 + bullishFactors * 10;
  } else if (bearishFactors >= 2) {
    signal = "sell";
    confluence = 60 + bearishFactors * 10;
  }

  const overallConfidence = (smcConf + volConf + sentConf) / 3;

  return {
    signal_type: signal,
    confidence: Math.round(overallConfidence),
    smc_conf: Math.round(smcConf),
    vol_conf: Math.round(volConf),
    sent_conf: Math.round(sentConf),
    confluence: Math.round(confluence),
  };
}
