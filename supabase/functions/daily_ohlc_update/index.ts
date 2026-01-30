/**
 * Daily OHLC Update Cron Job
 * Runs daily after market close (5pm ET) to fetch the previous trading day's data
 * Updates all symbols that have existing data in market_ohlc_daily
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OHLCBar {
  symbol: string;
  timestamp: string;
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

    console.log('[daily_ohlc_update] Starting daily update...');

    // Get all unique symbols that have data
    const { data: symbolData, error: symbolError } = await supabase
      .from('market_ohlc_daily')
      .select('symbol')
      .order('symbol');

    if (symbolError) {
      throw new Error(`Failed to fetch symbols: ${symbolError.message}`);
    }

    // Get unique symbols
    const symbols = [...new Set(symbolData.map(row => row.symbol))];
    console.log(`[daily_ohlc_update] Found ${symbols.length} symbols to update`);

    let totalInserted = 0;
    const errors: string[] = [];

    // Fetch last 2 days of data for each symbol (in case we missed yesterday)
    for (const symbol of symbols) {
      try {
        console.log(`[daily_ohlc_update] Fetching ${symbol}...`);
        
        const bars = await fetchRecentData(symbol, 2);
        
        if (bars.length === 0) {
          console.warn(`[daily_ohlc_update] No new data for ${symbol}`);
          continue;
        }

        // Upsert to database
        const { error } = await supabase
          .from('market_ohlc_daily')
          .upsert(bars, { onConflict: 'symbol,timestamp' });

        if (error) {
          console.error(`[daily_ohlc_update] DB error for ${symbol}:`, error);
          errors.push(`${symbol}: ${error.message}`);
          continue;
        }

        totalInserted += bars.length;
        console.log(`[daily_ohlc_update] ✓ ${symbol}: ${bars.length} bars`);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));

      } catch (error) {
        console.error(`[daily_ohlc_update] Error for ${symbol}:`, error);
        errors.push(`${symbol}: ${error.message}`);
      }
    }

    console.log(`[daily_ohlc_update] Complete: ${totalInserted} bars inserted, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        symbolsProcessed: symbols.length,
        totalInserted,
        errors,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('[daily_ohlc_update] Fatal error:', error);
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
 * Fetch recent data (last N days) from Yahoo Finance
 */
async function fetchRecentData(symbol: string, days: number): Promise<OHLCBar[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1h&period1=${period1}&period2=${period2}`;

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
