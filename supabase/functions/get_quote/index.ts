/**
 * Get Quote Edge Function
 * Returns real-time stock quote with caching
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { fetchQuote } from '../_shared/yahoo_v8_client.ts';
import { sanitizeTicker, validateTicker } from '../shared/normalize.ts';
import { quoteLimiter, globalLimiter, getClientKey, rateLimitResponse } from '../shared/rate_limit.ts';

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
    if (!globalLimiter.isAllowed(clientKey) || !quoteLimiter.isAllowed(clientKey)) {
      return rateLimitResponse(quoteLimiter.getResetSeconds(clientKey));
    }

    // Parse request
    const { ticker } = await req.json();
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

    // Fetch quote using yahoo_v8_client (includes caching)
    const quoteResult = await fetchQuote(cleanTicker);
    
    if (!quoteResult) {
      return new Response(
        JSON.stringify({ error: 'no_data_available', message: 'Unable to fetch quote data' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map to existing response format
    const normalizedData = {
      ticker: quoteResult.symbol,
      price: quoteResult.price,
      change: quoteResult.change,
      changePercent: quoteResult.changePercent,
      volume: quoteResult.volume,
      currency: quoteResult.currency || 'USD',
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
