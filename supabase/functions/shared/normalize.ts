/**
 * Normalizes Yahoo Finance responses to standard format
 */

import type { YahooChartResponse, YahooQuoteSummaryResponse } from './yahoo_client.ts';

export interface NormalizedQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  percent_change: number;
  currency: string;
  market_cap: number | null;
  volume: number;
  timestamp: number;
  chart?: ChartData;
}

export interface ChartData {
  timestamps: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/**
 * Normalize chart response to standard format
 */
export function normalizeChartData(response: YahooChartResponse): NormalizedQuote {
  const result = response.chart.result[0];
  if (!result) {
    throw new Error('No data in Yahoo Finance response');
  }

  const meta = result.meta;
  const quote = result.indicators.quote[0];
  
  const currentPrice = meta.regularMarketPrice;
  const previousClose = meta.previousClose || meta.chartPreviousClose;
  const change = currentPrice - previousClose;
  const percentChange = (change / previousClose) * 100;

  return {
    symbol: meta.symbol,
    name: meta.symbol, // Chart endpoint doesn't include name
    price: currentPrice,
    change: parseFloat(change.toFixed(2)),
    percent_change: parseFloat(percentChange.toFixed(2)),
    currency: meta.currency,
    market_cap: null,
    volume: quote.volume?.reduce((a, b) => a + (b || 0), 0) || 0,
    timestamp: Math.floor(Date.now() / 1000),
    chart: {
      timestamps: result.timestamp,
      open: quote.open.map(v => v || 0),
      high: quote.high.map(v => v || 0),
      low: quote.low.map(v => v || 0),
      close: quote.close.map(v => v || 0),
      volume: quote.volume.map(v => v || 0),
    },
  };
}

/**
 * Normalize quote summary to standard format
 */
export function normalizeQuoteSummary(response: YahooQuoteSummaryResponse): NormalizedQuote {
  const result = response.quoteSummary.result[0];
  if (!result) {
    throw new Error('No data in Yahoo Finance response');
  }

  const price = result.price;

  return {
    symbol: price.symbol,
    name: price.shortName || price.symbol,
    price: price.regularMarketPrice.raw,
    change: price.regularMarketChange.raw,
    percent_change: price.regularMarketChangePercent.raw,
    currency: price.currency,
    market_cap: price.marketCap?.raw || null,
    volume: price.regularMarketVolume.raw,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Merge chart and quote data
 */
export function mergeQuoteAndChart(
  quote: NormalizedQuote,
  chart: NormalizedQuote
): NormalizedQuote {
  return {
    ...quote,
    chart: chart.chart,
  };
}

/**
 * Validate ticker symbol format
 */
export function validateTicker(ticker: string): boolean {
  // Basic validation: 1-10 alphanumeric characters, dots, hyphens, equals
  const regex = /^[A-Z0-9.\-=^]{1,10}$/i;
  return regex.test(ticker);
}

/**
 * Sanitize ticker (uppercase, trim)
 */
export function sanitizeTicker(ticker: string): string {
  return ticker.toUpperCase().trim();
}
