/**
 * Get Chart Data Edge Function
 * Returns chart data in time-series format
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchChart } from "../_shared/yahoo_v8_client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker, interval = '1d', range = '1mo' } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch chart using yahoo_v8_client (includes caching)
    const chartResult = await fetchChart({
      symbol: ticker.toUpperCase(),
      interval: interval as any,
      range: range as any,
    });

    if (!chartResult) {
      throw new Error('Failed to fetch chart data');
    }

    // Transform to time-series format (array of objects)
    const chartData = chartResult.timestamps.map((timestamp: number, index: number) => ({
      timestamp: new Date(timestamp * 1000).toISOString(),
      open: chartResult.opens[index],
      high: chartResult.highs[index],
      low: chartResult.lows[index],
      close: chartResult.closes[index],
      volume: chartResult.volumes[index],
    })).filter((point: any) => 
      point.open !== null && 
      point.high !== null && 
      point.low !== null && 
      point.close !== null
    );

    return new Response(
      JSON.stringify(chartData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
