/**
 * Get Trending Edge Function
 * Returns trending tickers for a region with caching
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { fetchTrending } from '../_shared/yahoo_v8_client.ts';
import { trendingLimiter, globalLimiter, getClientKey, rateLimitResponse } from '../shared/rate_limit.ts';

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
    if (!globalLimiter.isAllowed(clientKey) || !trendingLimiter.isAllowed(clientKey)) {
      return rateLimitResponse(trendingLimiter.getResetSeconds(clientKey));
    }

    // Parse request (region is optional, defaults to US)
    const { region = 'US' } = await req.json().catch(() => ({ region: 'US' }));

    // Fetch trending using yahoo_v8_client (includes caching)
    const trendingItems = await fetchTrending(region);
    
    if (!trendingItems || trendingItems.length === 0) {
      return new Response(
        JSON.stringify({ error: 'no_data_available', message: 'Unable to fetch trending data' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map to existing response format
    const result = {
      region,
      tickers: trendingItems.map(item => item.symbol),
      count: trendingItems.length,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Return response
    return new Response(
      JSON.stringify(result),
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
