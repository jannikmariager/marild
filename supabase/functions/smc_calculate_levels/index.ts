/**
 * SMC Calculate Levels Edge Function
 * Calculates Order Blocks, BOS, Sessions, and Ranges
 * Stores results in Postgres tables
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { fetchChart } from '../_shared/yahoo_v8_client.ts';
import {
  detectSwingPoints,
  detectBOS,
  detectOrderBlocks,
  calculateSessionRanges,
  checkMitigation,
  type OHLCBar,
} from '../shared/smc_detector.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker, timeframe = '1h' } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'missing_ticker', message: 'Ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate timeframe
    const validTimeframes = ['5m', '15m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(timeframe)) {
      return new Response(
        JSON.stringify({ error: 'invalid_timeframe', message: 'Must be 5m, 15m, 1h, 4h, or 1d' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map timeframe to Yahoo Finance intervals and ranges
    const intervalMap: Record<string, { interval: string; range: string }> = {
      '5m': { interval: '5m', range: '5d' },
      '15m': { interval: '15m', range: '5d' },
      '1h': { interval: '1h', range: '1mo' },
      '4h': { interval: '1h', range: '3mo' }, // Yahoo doesn't have 4h, use 1h and aggregate
      '1d': { interval: '1d', range: '6mo' },
    };

    const { interval, range } = intervalMap[timeframe];

    // Fetch OHLC data using yahoo_v8_client (includes caching)
    console.log(`Fetching chart data for ${ticker} (${interval}, ${range})`);
    let chartResult;
    try {
      chartResult = await fetchChart({
        symbol: ticker,
        interval: interval as any,
        range: range as any,
      });
    } catch (error) {
      console.error('Yahoo Finance error:', error);
      return new Response(
        JSON.stringify({ error: 'no_data', message: 'Unable to fetch chart data from Yahoo Finance' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!chartResult) {
      return new Response(
        JSON.stringify({ error: 'no_data', message: 'Chart data not available' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert ChartResult to OHLC format for SMC detector
    const bars: OHLCBar[] = chartResult.timestamps.map(
      (timestamp: number, i: number) => ({
        timestamp: new Date(timestamp * 1000).toISOString(),
        open: chartResult.opens[i],
        high: chartResult.highs[i],
        low: chartResult.lows[i],
        close: chartResult.closes[i],
        volume: chartResult.volumes[i],
      })
    ).filter((bar: OHLCBar) => bar.open && bar.high && bar.low && bar.close); // Remove null bars

    if (bars.length < 50) {
      return new Response(
        JSON.stringify({ error: 'insufficient_data', message: 'Not enough historical data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${bars.length} bars for SMC detection`);

    // Run SMC detection algorithms
    const swingPoints = detectSwingPoints(bars, 5);
    const bosEvents = detectBOS(bars, swingPoints);
    const orderBlocks = detectOrderBlocks(bars, bosEvents);
    const sessions = calculateSessionRanges(bars, ticker);

    console.log(`Detected: ${orderBlocks.length} OBs, ${bosEvents.length} BOS, ${sessions.length} sessions`);

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Clear old data for this ticker/timeframe (keep last 30 days only)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await supabase
      .from('smc_order_blocks')
      .delete()
      .eq('ticker', ticker)
      .eq('timeframe', timeframe)
      .lt('created_at', thirtyDaysAgo.toISOString());

    await supabase
      .from('smc_bos_events')
      .delete()
      .eq('ticker', ticker)
      .eq('timeframe', timeframe)
      .lt('created_at', thirtyDaysAgo.toISOString());

    await supabase
      .from('smc_session_ranges')
      .delete()
      .eq('ticker', ticker)
      .lt('created_at', thirtyDaysAgo.toISOString());

    // Insert order blocks
    const obInserts = orderBlocks.map((ob, index) => {
      const mitigation = checkMitigation(ob, bars, bars.findIndex(b => b.timestamp === ob.close_time));
      return {
        ticker,
        timeframe,
        direction: ob.direction,
        high: ob.high,
        low: ob.low,
        open_time: ob.open_time,
        close_time: ob.close_time,
        mitigated: mitigation.mitigated,
        mitigation_time: mitigation.mitigation_time,
        origin: ob.origin,
      };
    });

    if (obInserts.length > 0) {
      const { error: obError } = await supabase.from('smc_order_blocks').insert(obInserts);
      if (obError) {
        console.error('Error inserting order blocks:', obError);
      }
    }

    // Insert BOS events
    const bosInserts = bosEvents.map(bos => ({
      ticker,
      timeframe,
      direction: bos.direction,
      price: bos.price,
      event_time: bos.event_time,
      strength: bos.strength,
    }));

    if (bosInserts.length > 0) {
      const { error: bosError } = await supabase.from('smc_bos_events').insert(bosInserts);
      if (bosError) {
        console.error('Error inserting BOS events:', bosError);
      }
    }

    // Insert session ranges
    const sessionInserts = sessions.map(session => ({
      ticker,
      session_date: session.session_date,
      session_type: session.session_type,
      high: session.high,
      low: session.low,
      open_time: session.open_time,
      close_time: session.close_time,
    }));

    if (sessionInserts.length > 0) {
      const { error: sessionError } = await supabase.from('smc_session_ranges').insert(sessionInserts);
      if (sessionError) {
        console.error('Error inserting sessions:', sessionError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ticker,
        timeframe,
        stats: {
          order_blocks: orderBlocks.length,
          bos_events: bosEvents.length,
          sessions: sessions.length,
          bars_processed: bars.length,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
