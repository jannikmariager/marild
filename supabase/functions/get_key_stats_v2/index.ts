import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getKeyStats } from "../_shared/stockDataClient.ts";

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

    const stats = await getKeyStats(ticker.toUpperCase());

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get_key_stats_v2 error:", error);

    const errorResponse = {
      error: "KEY_STATS_ERROR",
      message: error.message || "Failed to fetch key stats",
      ticker: "unknown",
      canRetry: true,
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
