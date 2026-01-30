/**
 * Signals Visibility Evaluator
 *
 * Decouples signal generation from publication.
 *
 * Responsibilities:
 * - Evaluate newly created ai_signals and set visibility_state + published_at.
 * - Apply upgrade logic (upgraded_from_signal_id, escalation to Discord / push).
 * - Enforce basic safety brakes (daily cap, per-ticker cooldown).
 * - Trigger Discord + push only for curated signals.
 *
 * NOTE: This function does NOT trade or generate signals; it only operates
 * on existing ai_signals rows. Engine + live trading must remain independent.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import type { AISignalRow } from '../_shared/signal_types.ts';
import { sendDiscordSignalNotification } from '../_shared/discord_signals_notifier.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Visibility buckets
const VIS_HIDDEN = 'hidden';
const VIS_APP_ONLY = 'app_only';
const VIS_APP_DISCORD = 'app_discord';
const VIS_APP_DISCORD_PUSH = 'app_discord_push';

type VisibilityState = typeof VIS_HIDDEN | typeof VIS_APP_ONLY | typeof VIS_APP_DISCORD | typeof VIS_APP_DISCORD_PUSH;

// Safety brakes
// Hard daily cap for Discord/push signals. We always select the TOP N by confidence for the day.
const MAX_PUBLISHED_PER_DAY = 15; // only the 15 highest-confidence signals per day may reach Discord/push
const TICKER_PUBLISH_COOLDOWN_HOURS = 6; // one published signal per ticker/timeframe per 6h unless upgrade

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStartTime = Date.now();
  const runStartedAt = new Date().toISOString();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const now = new Date();

    // Look back 12 hours for signals; this covers base visibility + upgrade logic.
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

    const { data: rawSignals, error: fetchError } = await supabase
      .from('ai_signals')
      .select('*')
      .gte('created_at', twelveHoursAgo)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('[signals_visibility_evaluator] Failed to fetch ai_signals:', fetchError);
      throw new Error(fetchError.message);
    }

    let signals: AISignalRow[] = (rawSignals || []) as AISignalRow[];
    const tradeableSignals = signals.filter((s) => s.trade_gate_allowed !== false);
    const blockedSignals = signals.length - tradeableSignals.length;
    if (blockedSignals > 0) {
      console.log(
        `[signals_visibility_evaluator] Skipping ${blockedSignals} signals gated by trade window`,
      );
    }
    if (tradeableSignals.length === 0) {
      console.log('[signals_visibility_evaluator] No recent signals to evaluate');
      return jsonResponse({ evaluated: 0, upgraded: 0, publishedToDiscord: 0, suppressed: 0 });
    }
    signals = tradeableSignals;

    // Build key = symbol + timeframe + direction (use ai_decision if present, else signal_type)
    interface GroupedSignal extends AISignalRow {
      _direction: string;
    }

    const grouped = new Map<string, GroupedSignal[]>();
    for (const s of signals) {
      const dir = (s.ai_decision || s.signal_type || 'neutral').toLowerCase();
      const key = `${s.symbol}|${s.timeframe}|${dir}`;
      const extended: GroupedSignal = Object.assign({ _direction: dir }, s);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(extended);
    }

    // Pre-compute daily published count (Discord-capable visibility states)
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const { data: todayPublishedRows, error: todayError } = await supabase
      .from('ai_signals')
      .select('id, visibility_state, created_at')
      .gte('created_at', startOfDay.toISOString())
      .in('visibility_state', [VIS_APP_DISCORD, VIS_APP_DISCORD_PUSH]);

    if (todayError) {
      console.error('[signals_visibility_evaluator] Failed to count today published:', todayError);
    }

    let publishedToday = todayPublishedRows?.length || 0;

    let evaluatedCount = 0;
    let upgradedCount = 0;
    let publishedToDiscordCount = 0;
    let suppressedCount = 0;

    // Helper: upserts to run after evaluation
    const updates: any[] = [];

    // Global daily selection: only the TOP (MAX_PUBLISHED_PER_DAY - publishedToday) signals by confidence
    // are allowed to reach Discord/push for the rest of the day.
    const remainingDiscordSlots = Math.max(0, MAX_PUBLISHED_PER_DAY - publishedToday);
    const allowedDiscordIds = new Set<string>();

    if (remainingDiscordSlots > 0) {
      const sortedByConf = [...signals]
        .filter((s) => (s.confidence_score ?? 0) >= 60)
        .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));

      const top = sortedByConf.slice(0, remainingDiscordSlots);
      for (const s of top) {
        if (s.id) {
          allowedDiscordIds.add(s.id as string);
        }
      }

      console.log(
        `[signals_visibility_evaluator] Daily Discord slots remaining=${remainingDiscordSlots}, ` +
          `selected top=${allowedDiscordIds.size} by confidence`,
      );
    } else {
      console.log(
        '[signals_visibility_evaluator] Daily Discord cap already reached; no new Discord signals will be escalated today',
      );
    }

    // For per-ticker cooldown, pre-load last published per symbol/timeframe in last 6h
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const { data: recentPublished, error: recentPubError } = await supabase
      .from('ai_signals')
      .select('id, symbol, timeframe, visibility_state, created_at, confidence_score')
      .gte('created_at', sixHoursAgo)
      .in('visibility_state', [VIS_APP_DISCORD, VIS_APP_DISCORD_PUSH]);

    if (recentPubError) {
      console.error('[signals_visibility_evaluator] Failed to fetch recent published:', recentPubError);
    }

    const recentPublishedMap = new Map<string, AISignalRow>();
    for (const r of recentPublished || []) {
      const key = `${r.symbol}|${r.timeframe}`;
      const current = recentPublishedMap.get(key);
      if (!current || new Date(r.created_at) > new Date(current.created_at)) {
        recentPublishedMap.set(key, r as AISignalRow);
      }
    }

    // Evaluate each (symbol, timeframe, direction) group
    for (const [groupKey, groupSignals] of grouped.entries()) {
      // Signals already sorted ascending by created_at from the DB query
      let previous: GroupedSignal | null = null;

      for (const s of groupSignals) {
        evaluatedCount++;
        const conf = s.confidence_score ?? 0;
        let vis: VisibilityState | null = (s.visibility_state as VisibilityState | null) ?? null;
        let updatedPublishedAt: string | null | undefined = s.published_at ?? null;
        let upgradedFrom: string | null | undefined = s.upgraded_from_signal_id ?? null;

        // Base visibility by confidence (first time only)
        if (!vis) {
          if (conf < 60) {
            vis = VIS_HIDDEN;
            suppressedCount++;
          } else {
            vis = VIS_APP_ONLY;
            updatedPublishedAt = new Date().toISOString();
          }
        }

        // Upgrade logic vs previous signal in this group
        if (previous) {
          const isNewer = new Date(s.created_at) > new Date(previous.created_at);
          const improvedEnough = conf > (previous.confidence_score ?? 0) + 3;
          const strongEnough = conf >= 65;

          if (isNewer && (improvedEnough || strongEnough)) {
            // Candidate for escalation
            const baseSymbolKey = `${s.symbol}|${s.timeframe}`;
            const recentPub = recentPublishedMap.get(baseSymbolKey);

            // Per-ticker 6h cooldown: if we already have a published signal in last 6h,
            // only allow if this is truly an upgrade (higher confidence than that one).
            if (!recentPub || conf > (recentPub.confidence_score ?? 0)) {
              // Global daily selection: only allow escalation if this signal is in the
              // precomputed TOP-N set for the day.
              const isAllowedToday = allowedDiscordIds.has(s.id as string);

              if (isAllowedToday && publishedToday < MAX_PUBLISHED_PER_DAY) {
                upgradedFrom = previous.id;
                if (conf >= 65) {
                  vis = VIS_APP_DISCORD_PUSH;
                } else {
                  vis = VIS_APP_DISCORD;
                }
                publishedToday++;
                upgradedCount++;

                // Update recentPublishedMap for cooldown tracking
                recentPublishedMap.set(baseSymbolKey, s);

                // Trigger Discord + (optionally) push for this signal
                try {
                  await sendDiscordSignalNotification({ ...(s as any), visibility_state: vis } as AISignalRow, 'hourly');
                  publishedToDiscordCount++;
                } catch (err) {
                  console.error('[signals_visibility_evaluator] Discord notify error for', s.id, err);
                }
              } else {
                // Either daily top-N selection or cap prevents escalation → keep at app_only
                // but do not downgrade if already escalated.
                if (vis === VIS_APP_DISCORD || vis === VIS_APP_DISCORD_PUSH) {
                  // leave as-is
                } else {
                  vis = VIS_APP_ONLY;
                }
              }
            }
          }
        }

        // Queue DB update if anything changed
        if (
          vis !== s.visibility_state ||
          updatedPublishedAt !== s.published_at ||
          upgradedFrom !== s.upgraded_from_signal_id
        ) {
          updates.push({
            id: s.id,
            visibility_state: vis,
            published_at: updatedPublishedAt,
            upgraded_from_signal_id: upgradedFrom,
          });
        }

        previous = s;
      }
    }

    // Apply batched updates
    if (updates.length > 0) {
      const { error: updateError } = await supabase.from('ai_signals').upsert(updates, { onConflict: 'id' });
      if (updateError) {
        console.error('[signals_visibility_evaluator] Failed to upsert visibility updates:', updateError);
        throw new Error(updateError.message);
      }
    }

    const runDurationMs = Date.now() - runStartTime;

    // Persist a lightweight run log into signal_run_log for admin visibility
    try {
      const supabaseForLog = createClient(supabaseUrl, supabaseKey);
      const status = publishedToDiscordCount > 0 && suppressedCount === 0 && upgradedCount > 0 ? 'ok' : 'warn';

      await supabaseForLog.from('signal_run_log').insert({
        engine_type: 'VISIBILITY',
        source: 'cron',
        timeframe: '-',
        cron_jobname: 'signals_visibility_evaluator',
        run_started_at: runStartedAt,
        run_ended_at: new Date().toISOString(),
        duration_ms: runDurationMs,
        total_symbols: evaluatedCount,
        generated_count: upgradedCount,          // interpreted as "upgraded" count
        deduped_count: suppressedCount,          // interpreted as "suppressed/hidden" count
        no_trade_count: publishedToday,          // interpreted as "publishedToday" count
        error_count: 0,
        status,
      });
    } catch (logErr) {
      console.warn('[signals_visibility_evaluator] Failed to write signal_run_log entry:', logErr);
    }

    return jsonResponse({
      evaluated: evaluatedCount,
      upgraded: upgradedCount,
      publishedToDiscord: publishedToDiscordCount,
      suppressed: suppressedCount,
      publishedToday,
    });
  } catch (error: any) {
    console.error('[signals_visibility_evaluator] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
