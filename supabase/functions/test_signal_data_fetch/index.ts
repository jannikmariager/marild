/**
 * Test Endpoint for Signal Data Fetcher
 * 
 * Usage: POST /functions/v1/test_signal_data_fetch
 * Body: { "symbol": "AAPL", "timeframe": "1h" }
 * 
 * Returns the complete RawSignalInput structure with real data
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { assembleRawSignalInput } from "../_shared/signal_data_fetcher.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { symbol, timeframe = "1h" } = await req.json();

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "missing_symbol", message: "Symbol is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[test_signal_data_fetch] Testing ${symbol} ${timeframe}`);

    const startTime = Date.now();
    const rawSignalInput = await assembleRawSignalInput(symbol, timeframe);
    const duration = Date.now() - startTime;

    // Create a summary response (redact some verbose fields)
    const summary = {
      success: true,
      duration_ms: duration,
      symbol: rawSignalInput.symbol,
      timeframe: rawSignalInput.timeframe,
      fetched_at: rawSignalInput.fetched_at,
      
      data_summary: {
        ohlcv_bars: rawSignalInput.ohlcv.length,
        quote_price: rawSignalInput.quote.current_price,
        quote_change_percent: rawSignalInput.quote.change_percent,
        
        fundamentals_available: !!rawSignalInput.fundamentals?.market_cap,
        fundamentals_market_cap: rawSignalInput.fundamentals?.market_cap,
        fundamentals_pe_ratio: rawSignalInput.fundamentals?.pe_ratio,
        
        analyst_available: !!rawSignalInput.analyst,
        analyst_target_mean: rawSignalInput.analyst?.target_mean,
        
        news_count: rawSignalInput.news.length,
        news_headlines: rawSignalInput.news.slice(0, 3).map(n => n.headline),
        
        smc_order_blocks: rawSignalInput.smc.order_blocks.length,
        smc_bos_events: rawSignalInput.smc.bos_events.length,
        smc_sessions: rawSignalInput.smc.session_ranges.length,
        
        volume_metrics: {
          relative_volume: rawSignalInput.volume_metrics.relative_volume.toFixed(2),
          volume_trend: rawSignalInput.volume_metrics.volume_trend,
          volume_spike: rawSignalInput.volume_metrics.volume_spike,
          order_flow_bias: rawSignalInput.volume_metrics.order_flow_bias,
        },
        
        sentiment_score: rawSignalInput.sentiment_score,
      },
      
      preliminary_signal: {
        raw_signal_type: rawSignalInput.raw_signal_type,
        raw_confidence: rawSignalInput.raw_confidence,
        smc_confidence: rawSignalInput.smc_confidence,
        volume_confidence: rawSignalInput.volume_confidence,
        sentiment_confidence: rawSignalInput.sentiment_confidence,
        confluence_score: rawSignalInput.confluence_score,
      },
    };

    // Optionally return full data if requested
    const includeFullData = req.url.includes("full=true");

    return new Response(
      JSON.stringify(includeFullData ? { summary, full_data: rawSignalInput } : summary, null, 2),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[test_signal_data_fetch] Error:", error);
    return new Response(
      JSON.stringify({
        error: "fetch_failed",
        message: error.message,
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
