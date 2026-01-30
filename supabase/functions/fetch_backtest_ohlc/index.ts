/**
 * Edge Function: fetch_backtest_ohlc
 * Fetches OHLC data for backtesting with cache-first strategy
 * Aggregates 1H to 4H for SWING engine
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { loadUnifiedOHLC, aggregate1hTo4h, type SupportedTimeframe } from '../_shared/ohlc_loader.ts';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { symbol, timeframe, engineType, horizonDays } = await req.json();

    if (!symbol || !timeframe || !engineType || !horizonDays) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[fetch_backtest_ohlc] Fetching ${symbol} ${timeframe} for ${engineType}, ${horizonDays} days`);

    const normalizedTf = timeframe.toLowerCase() as string;
    let tf: SupportedTimeframe;

    // Map input timeframe (including legacy 4H/4h/4H) to Massive-supported timeframe
    if (normalizedTf === '4h') {
      tf = '4h';
    } else {
      tf = normalizedTf as SupportedTimeframe;
    }

    // Load OHLC via unified Massive+Yahoo loader with gap-resilient horizon handling
    let bars;

    if (tf === '4h') {
      // For 4h backtests, load 1h unified data and aggregate to 4h
      const hourly = await loadUnifiedOHLC(symbol, '1h', horizonDays);
      bars = aggregate1hTo4h(hourly);
    } else {
      bars = await loadUnifiedOHLC(symbol, tf === '4h' ? '4h' : tf, horizonDays);
    }

    if (!bars || bars.length === 0) {
      console.error(`[fetch_backtest_ohlc] No OHLC data returned for ${symbol}/${tf}`);
      return new Response(
        JSON.stringify({ error: 'No OHLC data available', candles: [] }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[fetch_backtest_ohlc] Using ${bars.length} ${tf} bars from unified loader for horizon ${horizonDays}d`);

    // Convert bars (OHLCBar) to standard format with Unix ms timestamps
    const formattedCandles = bars.map((bar: any) => {
      const ts = new Date(bar.timestamp).getTime();
      
      return {
        timestamp: ts,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume || 0),
      };
    });

    return new Response(
      JSON.stringify({
        symbol,
        timeframe,
        engineType,
        horizonDays,
        candles: formattedCandles,
        count: formattedCandles.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[fetch_backtest_ohlc] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Local aggregation helpers are no longer needed here; use
 * aggregate1hTo4h from ../_shared/ohlc_loader.ts instead.
 */
