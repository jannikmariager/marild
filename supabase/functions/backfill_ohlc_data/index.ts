/**
 * Backfill OHLC Data
 * Populates market_ohlc_daily table with historical data from Yahoo
 * Run once to backfill, then use daily cron to update
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Top stocks, ETFs, and crypto
const SYMBOLS = [
  // Mega caps
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  // Tech
  'AVGO', 'ORCL', 'ADBE', 'CRM', 'CSCO', 'AMD', 'INTC', 'IBM', 'QCOM',
  // Finance
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK',
  // Healthcare
  'JNJ', 'UNH', 'PFE', 'ABBV', 'LLY', 'MRK', 'TMO',
  // Consumer
  'WMT', 'HD', 'COST', 'PG', 'KO', 'PEP', 'MCD', 'NKE',
  // Comm/Media
  'DIS', 'NFLX', 'CMCSA', 'T',
  // Industrial/Energy
  'BA', 'CAT', 'XOM', 'CVX',
  // Major ETFs
  'SPY', 'QQQ', 'IWM', 'VTI', 'VOO', 'DIA', 'EEM', 'GLD', 'TLT', 'AGG',
  // Leveraged ETFs
  'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'SPXL', 'SPXS', 'UPRO', 'TMF', 'TNA', 'UVXY',
  // Crypto (Yahoo uses -USD suffix)
  'BTC-USD', 'ETH-USD', 'BNB-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'AVAX-USD'
];

const DAYS_TO_BACKFILL = 200; // 200 calendar days (~140 trading days, need 100+ for EMA100)
const INTERVAL = '1h'; // Use 1h candles

interface OHLCBar {
  symbol: string;
  timestamp: string; // ISO timestamp for 1h bars
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { searchParams } = new URL(req.url);
    const symbolsParam = searchParams.get('symbols');
    const symbolsToFetch = symbolsParam ? symbolsParam.split(',') : SYMBOLS;

    console.log(`[backfill_ohlc_data] Starting backfill for ${symbolsToFetch.length} symbols`);

    let totalInserted = 0;
    let totalSkipped = 0;
    const errors: string[] = [];

    for (const symbol of symbolsToFetch) {
      try {
        console.log(`[backfill_ohlc_data] Fetching ${symbol}...`);
        
        const bars = await fetchYahooData(symbol, DAYS_TO_BACKFILL);
        
        if (bars.length === 0) {
          console.warn(`[backfill_ohlc_data] No data for ${symbol}`);
          errors.push(`${symbol}: No data returned`);
          continue;
        }

        // Upsert to database
        const { error } = await supabase
          .from('market_ohlc_daily')
          .upsert(bars, { onConflict: 'symbol,timestamp' });

        if (error) {
          console.error(`[backfill_ohlc_data] DB error for ${symbol}:`, error);
          errors.push(`${symbol}: ${error.message}`);
          continue;
        }

        totalInserted += bars.length;
        console.log(`[backfill_ohlc_data] ✓ ${symbol}: ${bars.length} bars`);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`[backfill_ohlc_data] Error for ${symbol}:`, error);
        errors.push(`${symbol}: ${error.message}`);
      }
    }

    console.log(`[backfill_ohlc_data] Complete: ${totalInserted} inserted, ${totalSkipped} skipped, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        symbolsProcessed: symbolsToFetch.length,
        totalInserted,
        totalSkipped,
        errors,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[backfill_ohlc_data] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Fetch historical data from Yahoo Finance
 */
async function fetchYahooData(symbol: string, days: number): Promise<OHLCBar[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${INTERVAL}&period1=${period1}&period2=${period2}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo API error: ${response.status}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];

  if (!result) {
    return [];
  }

  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0];

  if (!quotes) {
    return [];
  }

  const bars: OHLCBar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = quotes.open?.[i];
    const high = quotes.high?.[i];
    const low = quotes.low?.[i];
    const close = quotes.close?.[i];
    const volume = quotes.volume?.[i];

    if (open == null || high == null || low == null || close == null || volume == null) {
      continue;
    }

    const timestamp = new Date(timestamps[i] * 1000).toISOString();

    bars.push({
      symbol,
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return bars;
}
