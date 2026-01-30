/**
 * Hourly DAYTRADER Engine Signal Generation
 * 
 * Generates signals for the DAYTRADER AI engine
 * - Timeframes: 1m, 5m, 15m, 1h (analyzes all, executes on 1h)
 * - Schedule: '5 * * * *' (every hour at minute :05)
 * - Target: Active intraday traders exploiting micro-inefficiencies
 * 
 * ALL PRO GATED
 * 
 * Features:
 * - Engine-specific watchlist and timeframes
 * - Deduplication: Skips symbols updated in last 55 minutes
 * - Discord: Routes to DAYTRADER engine webhook channel (#daytrader-signals)
 * - Loose SMC requirements (micro order blocks, partial structure)
 * - High risk tolerance (up to 80/100)
 * - Fast momentum-driven entries
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { assembleRawSignalInput } from '../_shared/signal_data_fetcher.ts';
import { computeRuleSignal } from '../_shared/signal_scorer.ts';
import { evaluateSignalWithAI } from '../_shared/signal_ai_evaluator.ts';
import { signalToRow, isPricePlanSane } from '../_shared/signal_types.ts';
import { sendDiscordAlert } from '../_admin_shared/discord_helper.ts';
import { sendDiscordSignalNotification } from '../_shared/discord_signals_notifier.ts';
import { runDaytraderV71, type EngineInput, type EngineResult } from '../_shared/engines/engine_daytrader_v71.ts';
import { getActiveEngine, isDaytraderDisabled, logEngineConfigOnce } from '../_shared/config.ts';
// NOTE: this file lives at supabase/functions/hourly_daytrader_signals/index.ts
// so we need to go up 3 levels to reach repo root /engine.
import { v74FinalConfig } from '../../../engine/daytrader/v74_final_config.ts';
import { applyEngineFilterConfig } from '../../../engine/daytrader/v71_constants.ts';
import { getTradeGateStatus } from '../_shared/trade_gate.ts';
import { getWhitelistedTickers, logUniverseStats } from '../_shared/whitelist.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// DAYTRADER AI - Watchlist
// Uses approved daytrader tickers from engine_universe table
// Engine: V7.4 (unified high-performance daytrader with 1.25% risk, 0.7× ATR trailing)

// DAYTRADER AI - Timeframes
// Uses 5m bars for engine analysis (V7.4 operates on 5m)
// Generates signals hourly via cron
const TIMEFRAMES = ['5m'] as const;

// Engine identifier
const ENGINE_TYPE = 'DAYTRADER';

// Cache window for deduplication (55 minutes)
const CACHE_WINDOW_MINUTES = 55;

interface HourlySummary {
  engine_type: string;
  run_started_at: string;
  run_duration_ms: number;
  total_symbols: number;
  generated_count: number;
  deduped_count: number;
  no_trade_count: number;
  error_count: number;
  top_signals: Array<{
    symbol: string;
    timeframe: string;
    signal_type: string;
    confidence_score: number;
    confluence_score: number | null;
  }>;
}

async function loadFocusTickers(
  supabase: ReturnType<typeof createClient>,
  tradeDate: string,
  limit = 30,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('daily_focus_tickers')
    .select('symbol')
    .eq('trade_date', tradeDate)
    .order('rank', { ascending: true })
    .limit(limit);

  if (error) {
    console.warn('[hourly_daytrader_signals] Failed to load daily_focus_tickers:', error.message);
    return [];
  }

  return data?.map((row) => row.symbol) ?? [];
}

type SymbolResult =
  | { type: 'generated'; symbol: string; timeframe: string; signal_type: string; confidence_score: number; confluence_score: number | null; signal_id?: string }
  | { type: 'deduped'; symbol: string; timeframe: string; minutes_ago: number }
  | { type: 'no_trade'; symbol: string; timeframe: string; decision: string; reason?: string; meta?: Record<string, unknown> }
  | { type: 'error'; symbol: string; timeframe: string; error_message?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  logEngineConfigOnce('hourly_daytrader_signals');

  if (isDaytraderDisabled()) {
    console.log('[hourly_daytrader_signals] Daytrader disabled via MARILD_DISABLE_DAYTRADER, exiting no-op.');
    return new Response(
      JSON.stringify({ disabled: true, reason: 'Daytrader archived', engine: getActiveEngine() }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const runStartTime = Date.now();
  const runStartedAt = new Date().toISOString();

  console.log(`[hourly_daytrader_signals] Starting ${ENGINE_TYPE} V7.4 engine signal generation`);
  console.log(`[hourly_daytrader_signals] Timeframes: ${TIMEFRAMES.join(', ')}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const tradeGate = getTradeGateStatus(new Date());
    if (!tradeGate.allowed) {
      console.log(
        `[hourly_daytrader_signals] Trade gate closed (${tradeGate.reason}) at ${tradeGate.currentTimeET} ET. Skipping tradable daytrader signals.`,
      );
      return new Response(
        JSON.stringify({
          status: 'gate_blocked',
          reason: tradeGate.reason,
          currentTimeET: tradeGate.currentTimeET,
          gateStartET: tradeGate.gateStartET,
          gateEndET: tradeGate.gateEndET,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (symbolsArray.length === 0) {
      console.warn('[hourly_daytrader_signals] Selected universe empty after filtering; aborting run.');
      return new Response(
        JSON.stringify({ status: 'ok', reason: 'empty_universe_after_filter' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Apply V7.4 config globally
    applyEngineFilterConfig(v74FinalConfig);
    console.log('[hourly_daytrader_signals] Applied V7.4 final config');

    const whitelist = await getWhitelistedTickers(supabase);
    logUniverseStats('ticker_whitelist', whitelist.length);
    if (whitelist.length === 0) {
      console.warn('[hourly_daytrader_signals] No whitelisted tickers; skipping run.');
      return new Response(
        JSON.stringify({ status: 'ok', reason: 'empty_whitelist' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const whitelistSymbols = whitelist.map((row) => row.symbol);
    const whitelistSet = new Set(whitelistSymbols);

    const tradeDate = new Date().toISOString().slice(0, 10);
    const focusSymbols = await loadFocusTickers(supabase, tradeDate);
    const symbolsArray: string[] = focusSymbols.length
      ? focusSymbols.filter((symbol) => whitelistSet.has(symbol))
      : whitelistSymbols;
    if (focusSymbols.length) {
      console.log(
        `[hourly_daytrader_signals] Using ${focusSymbols.length} focus tickers for ${tradeDate}`,
      );
    } else {
      console.log(
        `[hourly_daytrader_signals] Focus list empty; falling back to ${symbolsArray.length} whitelisted tickers`,
      );
    }

    let generatedCount = 0;
    let dedupedCount = 0;
    let noTradeCount = 0;
    let errorCount = 0;
    const generatedSignals: Array<any> = [];
    
    console.log(`[hourly_daytrader_signals] Processing ${symbolsArray.length} symbols across ${TIMEFRAMES.length} timeframes`);

    // Process all symbol/timeframe combinations
    const allPromises = symbolsArray.flatMap(symbol => 
      TIMEFRAMES.map(async (timeframe) => {
        try {
          // Check if signal exists and was updated recently (deduplication)
          const recentSignal = await checkRecentSignal(supabase, symbol, timeframe, ENGINE_TYPE);

          if (recentSignal) {
            console.log(`[hourly_daytrader_signals] SKIP ${symbol}/${timeframe} - updated ${recentSignal.minutes_ago.toFixed(1)}min ago`);
            return { type: 'deduped', symbol, timeframe, minutes_ago: recentSignal.minutes_ago } as SymbolResult;
          }

          // Generate fresh signal using V7.4 engine
          console.log(`[hourly_daytrader_signals] GENERATING ${symbol}/${timeframe} with V7.4`);

          // Step 1: Fetch market data
          const rawInput = await assembleRawSignalInput(symbol, timeframe);

          // Step 2: Run V7.4 engine
          const engineInput: EngineInput = {
            symbol,
            style: ENGINE_TYPE as any,
            timeframe,
            horizonDays: 365,
            bars5m: rawInput.bars_5m,
          };

          const v74Result: EngineResult = await runDaytraderV71(engineInput);

          // Skip if engine says NO_TRADE or price plan is nonsensical
          if (
            v74Result.decision !== 'TRADE' ||
            !v74Result.entry ||
            !v74Result.stop ||
            !v74Result.target ||
            !isPricePlanSane(
              ENGINE_TYPE,
              v74Result.direction?.toLowerCase() === 'long' ? 'buy' : 'sell',
              v74Result.entry,
              v74Result.stop,
              v74Result.target,
            )
          ) {
            const reason = (v74Result as any)?.meta?.reason ? String((v74Result as any).meta.reason) : undefined;
            console.log(`[hourly_daytrader_signals] NO TRADE ${symbol}/${timeframe} - decision: ${v74Result.decision}${reason ? ` (reason: ${reason})` : ''}`);
            return {
              type: 'no_trade',
              symbol,
              timeframe,
              decision: v74Result.decision ?? 'NO_TRADE',
              reason,
              meta: ((v74Result as any).meta ?? undefined) as any,
            } as SymbolResult;
          }

          console.log(`[hourly_daytrader_signals] V7.4 TRADE ${symbol}/${timeframe} - ${v74Result.direction} @ ${v74Result.entry} (conf: ${v74Result.confidence})`);

          // Step 3: Compute rule signal for AI layer compatibility
          const ruleSignal = computeRuleSignal(rawInput, ENGINE_TYPE);
          
          // Inject V7.4 engine data into rule signal
          (ruleSignal as any).v74_engine_data = {
            pattern: v74Result.pattern,
            direction: v74Result.direction,
            entry: v74Result.entry,
            stop: v74Result.stop,
            target: v74Result.target,
            confidence: v74Result.confidence,
            rr: v74Result.rr,
          };

          // Override rule signal values with V7.4 engine output
          ruleSignal.signal_type = v74Result.direction?.toLowerCase() === 'long' ? 'BUY' : 'SELL';
          ruleSignal.raw_confidence = v74Result.confidence || 50;

          // Step 4: Evaluate with AI using DAYTRADER engine personality
          const evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal, undefined, ENGINE_TYPE);

          // Step 5: Tag with V7.4 engine
          (evaluatedSignal as any).engine_type = ENGINE_TYPE;
          (evaluatedSignal as any).engine_version = 'V7.4';

          // Step 6: Convert to database row (is_manual_request = false)
          const signalRecord = signalToRow(evaluatedSignal, false, {
            trade_gate_allowed: true,
            trade_gate_reason: tradeGate.reason,
            trade_gate_et_time: tradeGate.currentTimeET,
            blocked_until_et: null,
          });
          signalRecord.engine_version = 'V7.4';

          // Step 6: Insert into ai_signals
          // Note: The unique constraint is on (symbol, timeframe, engine_type, immutable_date(created_at))
          // Since we can't specify the computed column in onConflict, we rely on the DB to handle duplicates
          const { data, error } = await supabase
            .from('ai_signals')
            .insert(signalRecord)
            .select()
            .single();

          if (error) {
            console.error(`[hourly_daytrader_signals] DB error for ${symbol}/${timeframe}:`, error);
            return { type: 'error', symbol, timeframe, error_message: error.message };
          }

          // NOTE: Discord / push publishing is handled by signals_visibility_evaluator.
          // We intentionally do NOT post directly from generation to keep trading
          // decoupled from visibility / noise controls and to respect the
          // "top 15 per day" Discord cap.

          console.log(`[hourly_daytrader_signals] ✓ ${symbol}/${timeframe} - ${evaluatedSignal.signal_type.toUpperCase()} (conf: ${evaluatedSignal.confidence_score})`);
          
          return {
            type: 'generated',
            symbol,
            timeframe,
            signal_type: evaluatedSignal.signal_type,
            confidence_score: evaluatedSignal.confidence_score,
            confluence_score: ruleSignal.confluence_score,
            signal_id: (data as any)?.id,
          } as SymbolResult;

        } catch (symbolError) {
          console.error(`[hourly_daytrader_signals] Error processing ${symbol}/${timeframe}:`, symbolError);
          return { type: 'error', symbol, timeframe, error_message: String(symbolError?.message || symbolError) } as SymbolResult;
        }
      })
    );

    // Wait for all signals to complete
    const allResults = await Promise.all(allPromises);
    
    // Aggregate results
    for (const result of allResults as SymbolResult[]) {
      if (!result) continue;
      if (result.type === 'generated') {
        generatedCount++;
        generatedSignals.push(result);
      } else if (result.type === 'deduped') {
        dedupedCount++;
      } else if (result.type === 'no_trade') {
        noTradeCount++;
      } else if (result.type === 'error') {
        errorCount++;
      }
    }
    
    console.log(`[hourly_daytrader_signals] Processing complete: ${generatedCount} generated, ${dedupedCount} deduped, ${noTradeCount} no-trade, ${errorCount} errors`);

    const runDurationMs = Date.now() - runStartTime;

    // Build summary object
    const summary: HourlySummary = {
      engine_type: ENGINE_TYPE,
      run_started_at: runStartedAt,
      run_duration_ms: runDurationMs,
      total_symbols: symbolsArray.length * TIMEFRAMES.length,
      generated_count: generatedCount,
      deduped_count: dedupedCount,
      no_trade_count: noTradeCount,
      error_count: errorCount,
      top_signals: generatedSignals
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, 10),
    };

    console.log('[hourly_daytrader_signals] Summary:', {
      engine: ENGINE_TYPE,
      generated: generatedCount,
      deduped: dedupedCount,
      no_trade: noTradeCount,
      errors: errorCount,
      duration_sec: (runDurationMs / 1000).toFixed(1),
    });

    const status = errorCount > 0 ? 'error' : generatedCount === 0 ? 'warn' : 'ok';

    // Persist run log + per-symbol details for admin/debug UI
    try {
      const runLogId = crypto.randomUUID();

      const { error: runLogError } = await supabase.from('signal_run_log').insert({
        id: runLogId,
        engine_type: ENGINE_TYPE,
        source: 'cron',
        timeframe: TIMEFRAMES.join(','),
        cron_jobname: 'hourly_daytrader_signals',
        run_started_at: runStartedAt,
        run_ended_at: new Date().toISOString(),
        duration_ms: runDurationMs,
        total_symbols: symbolsArray.length * TIMEFRAMES.length,
        generated_count: generatedCount,
        deduped_count: dedupedCount,
        no_trade_count: noTradeCount,
        error_count: errorCount,
        status,
      });

      if (runLogError) {
        console.warn('[hourly_daytrader_signals] Failed to write signal_run_log:', runLogError);
      } else {
        const rows = (allResults as SymbolResult[])
          .filter(Boolean)
          .map((r) => {
            const base: Record<string, unknown> = {
              run_log_id: runLogId,
              engine_type: ENGINE_TYPE,
              timeframe: r.timeframe,
              symbol: r.symbol,
              result_type: r.type,
            };

            if (r.type === 'generated') {
              base.signal_id = r.signal_id ?? null;
              base.decision = 'TRADE';
            }

            if (r.type === 'deduped') {
              base.decision = 'DEDUPED';
              base.minutes_ago = r.minutes_ago;
            }

            if (r.type === 'no_trade') {
              base.decision = r.decision;
              base.reason = r.reason ?? null;
              base.meta = r.meta ?? null;
            }

            if (r.type === 'error') {
              base.decision = 'ERROR';
              base.error_message = r.error_message ?? null;
            }

            return base;
          });

        const { error: symbolLogError } = await supabase
          .from('signal_run_symbol_log')
          .insert(rows);

        if (symbolLogError) {
          console.warn('[hourly_daytrader_signals] Failed to write signal_run_symbol_log:', symbolLogError);
        }
      }
    } catch (e) {
      console.warn('[hourly_daytrader_signals] Failed to write run logs:', e);
    }

    // Send Discord notification (non-blocking)
    await sendDiscordNotification(summary).catch((err) => {
      console.warn('[hourly_daytrader_signals] Discord notification failed (non-fatal):', err);
    });

    // Send admin alert if something looks wrong
    await checkAndSendAdminAlert(summary).catch((err) => {
      console.warn('[hourly_daytrader_signals] Admin alert failed (non-fatal):', err);
    });

    return new Response(
      JSON.stringify({
        status: 'completed',
        ...summary,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[hourly_daytrader_signals] Fatal error:', error);

    // Send critical alert to Discord
    await sendDiscordAlert({
      severity: 'CRITICAL',
      title: `${ENGINE_TYPE} Hourly Signal Generation Failed`,
      message: error.message || 'Unknown error',
      context: {
        engine: ENGINE_TYPE,
        error: String(error),
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {
      // Ignore Discord errors in error handler
    });

    return new Response(
      JSON.stringify({
        status: 'error',
        error: error.message || 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Check if a signal for this symbol/timeframe/engine was updated recently
 */
async function checkRecentSignal(
  supabase: any,
  symbol: string,
  timeframe: string,
  engine_type: string
): Promise<{ minutes_ago: number } | null> {
  const { data, error } = await supabase
    .from('ai_signals')
    .select('updated_at')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('engine_type', engine_type)
    .or('trade_gate_allowed.is.null,trade_gate_allowed.eq.true')
    .single();

  if (error || !data) {
    return null; // No signal found
  }

  const updatedAt = new Date(data.updated_at);
  const now = new Date();
  const minutesAgo = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

  // Return signal if updated within cache window
  if (minutesAgo < CACHE_WINDOW_MINUTES) {
    return { minutes_ago: minutesAgo };
  }

  return null; // Signal is stale
}

/**
 * Send formatted Discord notification with run summary
 */
async function sendDiscordNotification(summary: HourlySummary): Promise<void> {
  const webhookUrl = Deno.env.get('DISCORD_DAYTRADER_WEBHOOK');

  if (!webhookUrl) {
    console.warn('[hourly_daytrader_signals] DISCORD_DAYTRADER_WEBHOOK not configured, skipping notification');
    return;
  }

  // Only send notification if signals were generated
  if (summary.generated_count === 0) {
    console.log('[hourly_daytrader_signals] No signals generated, skipping Discord notification');
    return;
  }

  // Determine color based on results
  // Use orange for DAYTRADER (aggressive, fast-paced)
  const color = summary.error_count > 5 ? 0xe74c3c : 0xe67e22; // Red if many errors, orange otherwise

  // Format top signals for display
  const topSignalsText = summary.top_signals
    .slice(0, 5)
    .map((sig, idx) => 
      `${idx + 1}. **${sig.symbol}** ${sig.timeframe} – ${sig.signal_type.toUpperCase()} – Conf: ${sig.confidence_score.toFixed(0)}, Confluence: ${sig.confluence_score?.toFixed(0) || 'N/A'}`
    )
    .join('\n');

  const embed = {
    title: `⚡ ${ENGINE_TYPE} AI – Hourly Run – ${new Date().toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' })} UTC`,
    description: `**Generated**: ${summary.generated_count} ✅ • **Deduped**: ${summary.deduped_count} ⏭️ • **No-Trade**: ${summary.no_trade_count} 💤 • **Errors**: ${summary.error_count} ${summary.error_count > 0 ? '⚠️' : ''}`,
    color: color,
    fields: [
      {
        name: '📊 Top Signals',
        value: topSignalsText || 'No signals generated',
        inline: false,
      },
      {
        name: '⏱️ Performance',
        value: `Duration: ${(summary.run_duration_ms / 1000).toFixed(1)}s • Total Pairs: ${summary.total_symbols}`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: `TradeLens AI ${ENGINE_TYPE} Engine | All signals PRO GATED`,
    },
  };

  const payload = {
    username: `TradeLens ${ENGINE_TYPE}`,
    avatar_url: 'https://your-logo-url.com/daytrader-logo.png', // Optional
    embeds: [embed],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
  }

  console.log('[hourly_daytrader_signals] Discord notification sent successfully');
}

/**
 * Check if admin should be alerted (error rate > 50%)
 */
async function checkAndSendAdminAlert(summary: HourlySummary): Promise<void> {
  const errorRate = summary.error_count / summary.total_symbols;
  
  // Alert if more than 50% of symbols failed
  if (errorRate > 0.5) {
    await sendDiscordAlert({
      severity: 'WARNING',
      title: `${ENGINE_TYPE} Engine High Error Rate`,
      message: `${summary.error_count} out of ${summary.total_symbols} symbols failed (${(errorRate * 100).toFixed(1)}%)`,
      context: {
        engine: ENGINE_TYPE,
        generated: summary.generated_count,
        deduped: summary.deduped_count,
        no_trade: summary.no_trade_count,
        errors: summary.error_count,
        timestamp: summary.run_started_at,
      },
    });
  }
}
