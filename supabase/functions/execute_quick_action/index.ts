// Edge Function: execute_quick_action
// Executes AI-powered Quick Actions with PRO gating
// POST endpoint that routes to appropriate action executor

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getUserSubscriptionStatus,
  hasProAccess,
} from "../_shared/subscription_checker.ts";
import type { QuickActionRequest, QuickActionId } from "../_shared/quickActionTypes.ts";
import {
  runAnalyzeWatchlist,
  runFindBullishSetups,
  runScanBreakouts,
  runCheckSectorRotation,
  runReviewPortfolioRisk,
  runFindBearishSetups,
  runUpcomingEarnings,
  runFindOversoldStocks,
  runFindOverboughtStocks,
  runDetectTrendReversals,
  runVolatilityRiskRegime,
  runMacroBriefing,
  runFindMomentumLeaders,
  runHighShortInterest,
  runAnalyzeMarketSentiment,
} from "../_shared/quickActionExecutors.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check subscription status with DEV_FORCE_PRO support
    const subscriptionStatus = await getUserSubscriptionStatus(
      user.id,
      supabaseUrl,
      supabaseServiceKey
    );
    const isPro = hasProAccess(subscriptionStatus);

    // PRO GATE - Return 402 if not PRO
    if (!isPro) {
      return new Response(
        JSON.stringify({
          error: "PRO_REQUIRED",
          message: "Quick AI Actions require TradeLens Pro. Upgrade to unlock.",
          locked: true,
          tier: subscriptionStatus.tier,
        }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const body = (await req.json()) as QuickActionRequest;

    // Validate action
    const validActions: QuickActionId[] = [
      "analyze-watchlist",
      "find-bullish-setups",
      "scan-breakouts",
      "check-sector-rotation",
      "review-portfolio-risk",
      "find-bearish-setups",
      "upcoming-earnings",
      "find-oversold-stocks",
      "find-overbought-stocks",
      "detect-trend-reversals",
      "volatility-risk-regime",
      "macro-briefing",
      "find-momentum-leaders",
      "high-short-interest",
      "analyze-market-sentiment",
    ];

    if (!validActions.includes(body.action)) {
      return new Response(
        JSON.stringify({ error: `Invalid action: ${body.action}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ---------- CACHING (2 hours) ----------
    const TTL_SECONDS = 2 * 60 * 60; // 2 hours
    const userScopedActions: QuickActionId[] = [
      "analyze-watchlist",
      "review-portfolio-risk",
    ];
    const isUserScoped = userScopedActions.includes(body.action);
    const cacheKey = isUserScoped ? `${body.action}:${user.id}` : body.action;

    // Check cache first
    const { data: cachedRow, error: cacheErr } = await supabase
      .from("ai_cache")
      .select("response, created_at, ttl_seconds")
      .eq("cache_key", cacheKey)
      .single();

    if (!cacheErr && cachedRow) {
      const createdAt = new Date(cachedRow.created_at).getTime();
      const ageSec = Math.floor((Date.now() - createdAt) / 1000);
      if (ageSec < cachedRow.ttl_seconds) {
        // Return cached response with metadata
        const payload = JSON.parse(cachedRow.response);
        return new Response(
          JSON.stringify({
            ...payload,
            cached: true,
            cache_key: cacheKey,
            cached_at: new Date(cachedRow.created_at).toISOString(),
            next_refresh_at: new Date(createdAt + cachedRow.ttl_seconds * 1000).toISOString(),
            ttl_seconds: cachedRow.ttl_seconds,
            age_seconds: ageSec,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Route to appropriate executor
    const executorParams = { supabase, user, body };
    let result;

    switch (body.action) {
      case "analyze-watchlist":
        result = await runAnalyzeWatchlist(executorParams);
        break;
      case "find-bullish-setups":
        result = await runFindBullishSetups(executorParams);
        break;
      case "scan-breakouts":
        result = await runScanBreakouts(executorParams);
        break;
      case "check-sector-rotation":
        result = await runCheckSectorRotation(executorParams);
        break;
      case "review-portfolio-risk":
        result = await runReviewPortfolioRisk(executorParams);
        break;
      case "find-bearish-setups":
        result = await runFindBearishSetups(executorParams);
        break;
      case "upcoming-earnings":
        result = await runUpcomingEarnings(executorParams);
        break;
      case "find-oversold-stocks":
        result = await runFindOversoldStocks(executorParams);
        break;
      case "find-overbought-stocks":
        result = await runFindOverboughtStocks(executorParams);
        break;
      case "detect-trend-reversals":
        result = await runDetectTrendReversals(executorParams);
        break;
      case "volatility-risk-regime":
        result = await runVolatilityRiskRegime(executorParams);
        break;
      case "macro-briefing":
        result = await runMacroBriefing(executorParams);
        break;
      case "find-momentum-leaders":
        result = await runFindMomentumLeaders(executorParams);
        break;
      case "high-short-interest":
        result = await runHighShortInterest(executorParams);
        break;
      case "analyze-market-sentiment":
        result = await runAnalyzeMarketSentiment(executorParams);
        break;
      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    // Persist full report for user history
    try {
      await supabase.from("ai_quick_action_reports").insert({
        user_id: user.id,
        action: body.action,
        generated_at: result.generatedAt || new Date().toISOString(),
        headline: result.headline,
        summary: result.summary,
        result_json: result,
      });
    } catch (historyErr) {
      console.warn("[execute_quick_action] Failed to save history report:", historyErr);
    }

    // Store in cache (upsert)
    const { error: upsertErr } = await supabase
      .from("ai_cache")
      .upsert({
        cache_key: cacheKey,
        response: JSON.stringify(result),
        model: "gpt-4o-mini",
        ttl_seconds: TTL_SECONDS,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (upsertErr) {
      console.warn("[execute_quick_action] Cache upsert failed:", upsertErr);
    }

    return new Response(
      JSON.stringify({
        ...result,
        cached: false,
        cache_key: cacheKey,
        cached_at: new Date().toISOString(),
        next_refresh_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
        ttl_seconds: TTL_SECONDS,
        age_seconds: 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[execute_quick_action] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
