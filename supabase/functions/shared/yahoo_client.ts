/**
 * @deprecated This file is DEPRECATED as of 2025-11-29
 * 
 * ALL functions have been migrated to use the unified yahoo_v8_client.ts
 * located at: supabase/functions/_shared/yahoo_v8_client.ts
 * 
 * This file is kept for reference only and should NOT be used in new code.
 * It will be removed in a future cleanup.
 * 
 * Migration: Use the new yahoo_v8_client.ts which provides:
 * - fetchQuote() - replaces getQuoteSummary()
 * - fetchBulkQuotes() - parallel quote fetching
 * - fetchChart() - replaces getChart()
 * - fetchNews() - stock news
 * - fetchTrending() - replaces getTrending()
 * - fetchFundamentals() - fundamental data
 * 
 * Benefits of new client:
 * - Unified caching via CacheManager
 * - Automatic retries with exponential backoff
 * - Timeout handling
 * - Type-safe interfaces
 * - Better error handling
 * 
 * DO NOT USE THIS FILE - USE _shared/yahoo_v8_client.ts INSTEAD
 */

export interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        symbol: string;
        currency: string;
        regularMarketPrice: number;
        previousClose: number;
        chartPreviousClose: number;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
      };
    }>;
    error: any;
  };
}

export interface YahooQuoteSummaryResponse {
  quoteSummary: {
    result: Array<{
      price: {
        symbol: string;
        shortName: string;
        regularMarketPrice: { raw: number };
        regularMarketChange: { raw: number };
        regularMarketChangePercent: { raw: number };
        currency: string;
        marketCap: { raw: number };
        regularMarketVolume: { raw: number };
      };
      summaryDetail: {
        volume: { raw: number };
        previousClose: { raw: number };
      };
    }>;
    error: any;
  };
}

export interface YahooTrendingResponse {
  finance: {
    result: Array<{
      quotes: Array<{
        symbol: string;
      }>;
    }>;
    error: any;
  };
}

export class YahooFinanceClient {
  private readonly baseUrl = 'https://query1.finance.yahoo.com';
  private readonly baseUrl2 = 'https://query2.finance.yahoo.com';
  private readonly timeout = 10000; // 10 seconds

  /**
   * Fetch chart data for a ticker
   */
  async getChart(
    ticker: string,
    range: string = '1mo',
    interval: string = '1d'
  ): Promise<YahooChartResponse> {
    const url = `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?interval=${interval}&range=${range}`;

    return this.fetchWithTimeout(url);
  }

  /**
   * Fetch quote summary with metadata
   */
  async getQuoteSummary(ticker: string): Promise<YahooQuoteSummaryResponse> {
    const url = `${this.baseUrl2}/v10/finance/quoteSummary/${encodeURIComponent(
      ticker
    )}?modules=price,summaryDetail,financialData`;

    return this.fetchWithTimeout(url);
  }

  /**
   * Fetch trending tickers for a region
   */
  async getTrending(region: string = 'US'): Promise<YahooTrendingResponse> {
    const url = `${this.baseUrl}/v1/finance/trending/${region}`;
    return this.fetchWithTimeout(url);
  }

  /**
   * Fetch with timeout and error mapping
   */
  private async fetchWithTimeout(url: string): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TradeLens/1.0)',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Check for Yahoo-specific errors
      if (data.chart?.error || data.quoteSummary?.error || data.finance?.error) {
        const error = data.chart?.error || data.quoteSummary?.error || data.finance?.error;
        throw new Error(`Yahoo Finance returned error: ${JSON.stringify(error)}`);
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout: Yahoo Finance took too long to respond');
      }
      throw error;
    }
  }
}

export const yahooClient = new YahooFinanceClient();
