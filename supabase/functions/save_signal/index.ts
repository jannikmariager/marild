/**
 * Save Signal Edge Function
 * Called when posting a signal to Discord to persist it in the database
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface SaveSignalRequest {
  ticker: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  tp1: number;
  tp2?: number;
  sl: number;
  confidence: number;
  timeframe: string;
  reasons?: string[];
  smc_data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  try {
    const body: SaveSignalRequest = await req.json();

    // Validate required fields
    if (!body.ticker || !body.direction || !body.entry_price || !body.tp1 || !body.sl || !body.confidence || !body.timeframe) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Insert signal into database
    const { data, error } = await supabase
      .from("signals")
      .insert({
        ticker: body.ticker,
        direction: body.direction,
        entry_price: body.entry_price,
        tp1: body.tp1,
        tp2: body.tp2 || null,
        sl: body.sl,
        confidence: body.confidence,
        timeframe: body.timeframe,
        reasons: body.reasons ? { items: body.reasons } : null,
        smc_data: body.smc_data || null,
        posted_to_discord: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to save signal:", error);
      return new Response(
        JSON.stringify({ error: "Failed to save signal", details: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    console.log(`Saved signal: ${body.ticker} ${body.direction} at $${body.entry_price}`);

    return new Response(
      JSON.stringify({ success: true, signal: data }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (err) {
    console.error("Error saving signal:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
