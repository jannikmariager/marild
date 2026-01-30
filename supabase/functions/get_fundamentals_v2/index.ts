/**
 * Get Fundamentals V2 Edge Function
 * Returns fundamental data (V2 endpoint)
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchFundamentals } from "../_shared/yahoo_v8_client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { ticker } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({
          error: "MISSING_TICKER",
          message: "ticker is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch fundamentals using yahoo_v8_client (includes caching)
    const fundData = await fetchFundamentals(ticker);

    if (!fundData) {
      throw new Error('Failed to fetch fundamental data');
    }

    // Return in same format as stockDataClient
    const fundamentals = {
      ticker: fundData.symbol,
      marketCap: fundData.marketCap,
      peRatio: fundData.peRatio,
      eps: fundData.eps,
      dividendYield: fundData.dividendYield,
      beta: fundData.beta,
      week52High: fundData.week52High,
      week52Low: fundData.week52Low,
      sector: fundData.sector,
      industry: fundData.industry,
    };

    return new Response(JSON.stringify(fundamentals), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get_fundamentals_v2 error:", error);

    const errorResponse = {
      error: "FUNDAMENTALS_ERROR",
      message: error.message || "Failed to fetch fundamentals",
      ticker: "unknown",
      canRetry: error.message?.includes("rate") || error.message?.includes("429"),
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
