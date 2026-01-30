/**
 * Pre-Market Active Symbols Sweep
 *
 * Builds the daily focus list (Focus Universe V2) from recent ai_signals,
 * partitioning into primary/momentum/fallback lanes without changing
 * downstream execution logic.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildFocusUniverseV2, type FocusLane } from "../_shared/focus_universe_v2.ts";
import { getFocusConfig } from "../_shared/config.ts";
import { getWhitelistedTickers, logUniverseStats } from "../_shared/whitelist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tradeDate = new Date().toISOString().slice(0, 10);
  const runStart = Date.now();
  const focusConfig = getFocusConfig();

  console.log(`[pre_market_active_symbols] Focus V2 run for ${tradeDate}`);

  const whitelist = await getWhitelistedTickers(supabase);
  logUniverseStats("ticker_whitelist", whitelist.length);
  if (whitelist.length === 0) {
    console.warn("[pre_market_active_symbols] No whitelisted tickers; skipping focus build");
    return new Response(
      JSON.stringify({ status: "ok", trade_date: tradeDate, focus_count: 0, avg_confidence: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const whitelistMeta = new Map(
    whitelist.map((row) => [row.symbol, { is_top8: row.is_top8, manual_priority: row.manual_priority }]),
  );
  const universeTickers = whitelist.map((row) => row.symbol);

  let focusResult;
  try {
    focusResult = await buildFocusUniverseV2({
      supabase,
      universeTickers,
      now: new Date(),
      config: focusConfig,
    });
  } catch (err) {
    console.error("[pre_market_active_symbols] focus_universe_v2 failed", err);
    return new Response(
      JSON.stringify({ status: "error", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const orderedTickers = focusResult.final.slice(0, focusConfig.maxTickers);

  // Build rows for daily_focus_tickers
  const laneByTicker = new Map<string, FocusLane>();
  [...focusResult.primary, ...focusResult.momentum, ...focusResult.fallback].forEach((t) =>
    laneByTicker.set(t.ticker, t.lane),
  );
  const metaByTicker = new Map<string, any>();
  [...focusResult.primary, ...focusResult.momentum, ...focusResult.fallback].forEach((t) =>
    metaByTicker.set(t.ticker, t),
  );

  let focusRows = orderedTickers.map((symbol, idx) => {
    const meta = metaByTicker.get(symbol);
    return {
      trade_date: tradeDate,
      symbol,
      rank: idx + 1,
      confidence: meta?.confidence ?? null,
      min_confidence: focusConfig.primaryMinConf,
      engines: ["SWING"],
      primary_engine: "SWING",
      metadata: {
        lane: laneByTicker.get(symbol) ?? "unknown",
        source: "focus_universe_v2",
        last_signal_at: meta?.signalCreatedAt ?? null,
        confidence: meta?.confidence ?? null,
        volatility_gate: meta?.volatilityGate ?? null,
      },
    };
  });

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const scoredRows = focusRows.map((row) => {
    const meta = whitelistMeta.get(row.symbol) ?? { is_top8: false, manual_priority: 0 };
    const confidence = Number(row.confidence ?? 0);
    const manualPriority = clamp(meta.manual_priority ?? 0, 0, 100);
    const score =
      (meta.is_top8 ? 30 : 0) +
      manualPriority * 0.4 +
      clamp(confidence, 0, 100) * 0.1;
    return {
      ...row,
      trade_priority_score: Number(score.toFixed(4)),
      score_components: {
        is_top8: meta.is_top8,
        manual_priority: manualPriority,
        confidence: confidence,
      },
    };
  }).sort((a, b) => {
    if ((b.trade_priority_score ?? 0) !== (a.trade_priority_score ?? 0)) {
      return (b.trade_priority_score ?? 0) - (a.trade_priority_score ?? 0);
    }
    const confDiff = Number(b.confidence ?? 0) - Number(a.confidence ?? 0);
    if (confDiff !== 0) return confDiff;
    return a.symbol.localeCompare(b.symbol);
  }).map((row, idx) => ({
    ...row,
    rank: idx + 1,
  }));

  await supabase.from("daily_focus_tickers").delete().eq("trade_date", tradeDate);

  if (scoredRows.length > 0) {
    const { error: insertError } = await supabase.from("daily_focus_tickers").insert(
      scoredRows.map((row) => ({
        ...row,
        trade_priority_score: row.trade_priority_score,
        score_components: row.score_components,
      })),
    );
    if (insertError) {
      console.error("[pre_market_active_symbols] Insert failed:", insertError);
      return new Response(
        JSON.stringify({ status: "error", message: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const focusCount = scoredRows.length;
  const avgConfidence =
    scoredRows.length > 0
      ? Number(
          (scoredRows.reduce((sum, t) => sum + Number(t.confidence ?? 0), 0) / scoredRows.length)
            .toFixed(2),
        )
      : 0;

  console.log(
    `[pre_market_active_symbols] Focus V2 stored ${focusCount} tickers (primary=${focusResult.primary.length}, momentum=${focusResult.momentum.length}, fallback=${focusResult.fallback.length}, avg=${avgConfidence})`,
  );

  return new Response(
    JSON.stringify({
      status: "ok",
      trade_date: tradeDate,
      focus_count: focusCount,
      avg_confidence: avgConfidence,
      run_duration_ms: Date.now() - runStart,
      focus_stats: focusResult.stats,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
