/**
 * Get Chart V2 Edge Function
 * Returns historical chart data (V2 endpoint)
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchChart } from "../_shared/yahoo_v8_client.ts";

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
    const { ticker, range = "1mo", interval = "1d" } = await req.json();

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

    // Fetch chart using yahoo_v8_client (includes caching)
    const chartResult = await fetchChart({
      symbol: ticker.toUpperCase(),
      interval: interval as any,
      range: range as any,
    });

    if (!chartResult) {
      return new Response(
        JSON.stringify({
          error: "CHART_ERROR",
          message: "Failed to fetch chart data",
          ticker: ticker.toUpperCase(),
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Return in same format as stockDataClient
    const chartData = {
      ticker: chartResult.symbol,
      timestamps: chartResult.timestamps,
      opens: chartResult.opens,
      highs: chartResult.highs,
      lows: chartResult.lows,
      closes: chartResult.closes,
      volumes: chartResult.volumes,
      interval: chartResult.interval,
    };

    return new Response(JSON.stringify(chartData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get_chart_v2 error:", error);

    const errorResponse = {
      error: "CHART_ERROR",
      message: error.message || "Failed to fetch chart data",
      ticker: "unknown",
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
