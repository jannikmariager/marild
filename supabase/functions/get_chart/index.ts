/**
 * Get Chart Edge Function
 * Returns historical chart data with caching
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { fetchChart } from '../_shared/yahoo_v8_client.ts';
import { sanitizeTicker, validateTicker } from '../shared/normalize.ts';
import { chartLimiter, globalLimiter, getClientKey, rateLimitResponse } from '../shared/rate_limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Rate limiting
    const clientKey = getClientKey(req);
    if (!globalLimiter.isAllowed(clientKey) || !chartLimiter.isAllowed(clientKey)) {
      return rateLimitResponse(chartLimiter.getResetSeconds(clientKey));
    }

    // Parse request
    const { ticker, range = '1mo', interval = '1d' } = await req.json();
    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'missing_ticker', message: 'Ticker parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and sanitize ticker
    const cleanTicker = sanitizeTicker(ticker);
    if (!validateTicker(cleanTicker)) {
      return new Response(
        JSON.stringify({ error: 'invalid_ticker', message: 'Invalid ticker symbol format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch chart using yahoo_v8_client (includes caching)
    const chartResult = await fetchChart({
      symbol: cleanTicker,
      interval: interval as any,
      range: range as any,
    });
    
    if (!chartResult) {
      return new Response(
        JSON.stringify({ error: 'no_data_available', message: 'Unable to fetch chart data' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map to existing response format (for backwards compatibility)
    const normalizedData = {
      ticker: chartResult.symbol,
      timestamps: chartResult.timestamps,
      opens: chartResult.opens,
      highs: chartResult.highs,
      lows: chartResult.lows,
      closes: chartResult.closes,
      volumes: chartResult.volumes,
      interval: chartResult.interval,
    };

    // Return response
    return new Response(
      JSON.stringify(normalizedData),
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
