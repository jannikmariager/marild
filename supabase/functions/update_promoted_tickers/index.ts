import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Updates promoted_tickers table based on historical signal and trade performance.
 * 
 * Strategy:
 * 1. For first 2-4 weeks: Use manual seed list (20 high-quality tickers)
 * 2. After threshold: Auto-promote based on V2 shadow performance
 * 3. Considers: avg confidence, win rate, avg R, signal count
 * 4. Respects blacklist for problem tickers
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("🔄 Updating promoted tickers...");

    const ENGINE_VERSION = "SWING_V2_ROBUST";
    const MIN_TRADES_FOR_AUTO_PROMOTION = 50; // Wait until V2 has 50+ trades
    const TOP_N_TICKERS = 20;
    const MIN_SIGNALS_THRESHOLD = 3; // Minimum signals to be considered
    const MIN_WIN_RATE = 0.45; // 45% minimum win rate

    // Blacklist: Tickers to never promote (add problem tickers here)
    const BLACKLIST = new Set([
      // Example: "PROBLEMATIC_TICKER"
    ]);

    // 1. Check if V2 has enough trades to enable auto-promotion
    const { data: v2Trades, error: tradesErr } = await supabase
      .from("engine_trades")
      .select("id")
      .eq("engine_key", "SWING")
      .eq("engine_version", ENGINE_VERSION)
      .eq("run_mode", "SHADOW");

    if (tradesErr) {
      console.error("Error fetching V2 trades:", tradesErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch trades" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const v2TradeCount = v2Trades?.length || 0;
    const useAutoPromotion = v2TradeCount >= MIN_TRADES_FOR_AUTO_PROMOTION;

    console.log(`V2 trade count: ${v2TradeCount}, Auto-promotion: ${useAutoPromotion}`);

    if (!useAutoPromotion) {
      // Keep using manual seed list
      console.log("⏳ Still using manual seed list (need 50+ V2 trades for auto-promotion)");
      return new Response(
        JSON.stringify({
          success: true,
          message: `Using manual seed list. V2 has ${v2TradeCount}/${MIN_TRADES_FOR_AUTO_PROMOTION} trades needed for auto-promotion.`,
          auto_promotion_enabled: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Calculate performance metrics per ticker from V2 shadow trades
    const { data: tickerPerformance, error: perfErr } = await supabase.rpc(
      "calculate_ticker_performance_v2",
      { p_engine_version: ENGINE_VERSION }
    );

    // If RPC doesn't exist yet, do it in code
    const { data: allTrades, error: allTradesErr } = await supabase
      .from("engine_trades")
      .select("ticker, realized_pnl, realized_r")
      .eq("engine_key", "SWING")
      .eq("engine_version", ENGINE_VERSION)
      .eq("run_mode", "SHADOW");

    if (allTradesErr) {
      console.error("Error fetching all trades:", allTradesErr);
      return new Response(
        JSON.stringify({ error: "Failed to analyze trades" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Get signal statistics per ticker (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: signals, error: signalsErr } = await supabase
      .from("ai_signals")
      .select("symbol, confidence_score")
      .eq("engine_type", "SWING")
      .gte("created_at", thirtyDaysAgo);

    if (signalsErr) {
      console.error("Error fetching signals:", signalsErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch signals" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Aggregate metrics per ticker
    const tickerMetrics = new Map<
      string,
      {
        signalCount: number;
        avgConfidence: number;
        tradeCount: number;
        winCount: number;
        avgR: number;
        totalPnl: number;
      }
    >();

    // Process signals
    for (const signal of signals || []) {
      const ticker = signal.symbol;
      if (BLACKLIST.has(ticker)) continue;

      if (!tickerMetrics.has(ticker)) {
        tickerMetrics.set(ticker, {
          signalCount: 0,
          avgConfidence: 0,
          tradeCount: 0,
          winCount: 0,
          avgR: 0,
          totalPnl: 0,
        });
      }

      const metrics = tickerMetrics.get(ticker)!;
      metrics.signalCount++;
      metrics.avgConfidence += signal.confidence_score;
    }

    // Calculate averages for signals
    for (const [ticker, metrics] of tickerMetrics.entries()) {
      if (metrics.signalCount > 0) {
        metrics.avgConfidence = metrics.avgConfidence / metrics.signalCount;
      }
    }

    // Process trades
    for (const trade of allTrades || []) {
      const ticker = trade.ticker;
      if (BLACKLIST.has(ticker)) continue;

      if (!tickerMetrics.has(ticker)) {
        tickerMetrics.set(ticker, {
          signalCount: 0,
          avgConfidence: 0,
          tradeCount: 0,
          winCount: 0,
          avgR: 0,
          totalPnl: 0,
        });
      }

      const metrics = tickerMetrics.get(ticker)!;
      metrics.tradeCount++;
      if (trade.realized_pnl > 0) metrics.winCount++;
      metrics.avgR += trade.realized_r || 0;
      metrics.totalPnl += trade.realized_pnl || 0;
    }

    // Calculate averages for trades
    for (const [ticker, metrics] of tickerMetrics.entries()) {
      if (metrics.tradeCount > 0) {
        metrics.avgR = metrics.avgR / metrics.tradeCount;
      }
    }

    // 5. Score and rank tickers
    interface ScoredTicker {
      ticker: string;
      score: number;
      metrics: typeof tickerMetrics extends Map<string, infer V> ? V : never;
    }

    const scoredTickers: ScoredTicker[] = [];

    for (const [ticker, metrics] of tickerMetrics.entries()) {
      // Filter: minimum signals and trades
      if (metrics.signalCount < MIN_SIGNALS_THRESHOLD) continue;

      const winRate = metrics.tradeCount > 0 ? metrics.winCount / metrics.tradeCount : 0;

      // Filter: minimum win rate
      if (winRate < MIN_WIN_RATE) continue;

      // Composite score (weighted):
      // - 30% avg confidence
      // - 30% win rate
      // - 25% avg R
      // - 15% signal frequency
      const score =
        metrics.avgConfidence * 0.30 +
        (winRate * 100) * 0.30 +
        (metrics.avgR * 50) * 0.25 + // Scale R to ~0-100 range
        (Math.min(metrics.signalCount, 20) * 5) * 0.15; // Cap signal bonus at 20

      scoredTickers.push({ ticker, score, metrics });
    }

    // Sort by score descending
    scoredTickers.sort((a, b) => b.score - a.score);

    // Take top N
    const topTickers = scoredTickers.slice(0, TOP_N_TICKERS);

    console.log(`📊 Top ${topTickers.length} tickers:`, topTickers.map(t => t.ticker));

    // 6. Update promoted_tickers table
    // First, demote all existing
    await supabase
      .from("promoted_tickers")
      .update({ is_promoted: false, last_updated: new Date().toISOString() })
      .eq("engine_version", ENGINE_VERSION);

    // Promote top tickers
    for (const { ticker, metrics } of topTickers) {
      const winRate = metrics.tradeCount > 0 ? metrics.winCount / metrics.tradeCount : 0;

      await supabase
        .from("promoted_tickers")
        .upsert(
          {
            engine_version: ENGINE_VERSION,
            ticker,
            avg_confidence: metrics.avgConfidence,
            signal_count: metrics.signalCount,
            is_promoted: true,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "engine_version,ticker" }
        );
    }

    console.log("✅ Promoted tickers updated successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message: `Updated promoted tickers based on performance`,
        auto_promotion_enabled: true,
        promoted_count: topTickers.length,
        top_tickers: topTickers.map(t => ({
          ticker: t.ticker,
          score: t.score.toFixed(2),
          win_rate: t.metrics.tradeCount > 0 
            ? ((t.metrics.winCount / t.metrics.tradeCount) * 100).toFixed(1) + "%"
            : "N/A",
          avg_r: t.metrics.avgR.toFixed(2),
          signals: t.metrics.signalCount,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Error updating promoted tickers:", error);
    return new Response(
      JSON.stringify({ error: (error as any)?.message ?? String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
