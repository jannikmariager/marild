/**
 * Get Fundamentals Edge Function
 * Returns fundamental data for a ticker
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchFundamentals } from "../_shared/yahoo_v8_client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch fundamentals using yahoo_v8_client (includes caching)
    const fundData = await fetchFundamentals(ticker);

    if (!fundData) {
      throw new Error('Failed to fetch fundamental data');
    }

    // Map to existing response format
    const fundamentals = {
      ticker: fundData.symbol,
      marketCap: fundData.marketCap,
      peRatio: fundData.peRatio,
      eps: fundData.eps,
      dividendYield: fundData.dividendYield ? fundData.dividendYield * 100 : null,
      week52High: fundData.week52High,
      week52Low: fundData.week52Low,
      sharesOutstanding: null, // Not in fetchFundamentals
      beta: fundData.beta,
    };

    return new Response(
      JSON.stringify(fundamentals),
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
