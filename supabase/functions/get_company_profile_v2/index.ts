import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCompanyProfile } from "../_shared/stockDataClient.ts";

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

    const profile = await getCompanyProfile(ticker.toUpperCase());

    return new Response(JSON.stringify(profile), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get_company_profile_v2 error:", error);

    const errorResponse = {
      error: "PROFILE_ERROR",
      message: error.message || "Failed to fetch company profile",
      ticker: "unknown",
      canRetry: error.message?.includes("rate") || error.message?.includes("429"),
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
