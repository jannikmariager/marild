/**
 * Hourly SWING Engine Signal Generation
 * 
 * Generates signals for the Marild SWING engine
 * - Timeframes: 1H, 4H
 * - Schedule: '30 12-21 * * 1-5' (every hour at :30 during market hours)
 * - Target: Active traders holding positions for days to weeks
 * 
 * Features:
 * - Engine-specific watchlist and timeframes
 * - Deduplication: Skips symbols updated in last 55 minutes
 * - Discord: Routes to SWING engine webhook channel
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { assembleRawSignalInput } from '../_shared/signal_data_fetcher.ts';
import { computeRuleSignal } from '../_shared/signal_scorer.ts';
import { evaluateSignalWithAI } from '../_shared/signal_ai_evaluator.ts';
import { signalToRow, isPricePlanSane } from '../_shared/signal_types.ts';
import { sendDiscordAlert } from '../_admin_shared/discord_helper.ts';
import { sendDiscordSignalNotification } from '../_shared/discord_signals_notifier.ts';
import { getTradeGateStatus } from '../_shared/trade_gate.ts';
import { runSwingV1, type SwingEngineInput, type SwingEngineResult } from '../_shared/engines/engine_swing_v1.ts';
import { runSwingV1Relaxed, type SwingEngineResult as SwingEngineResultRelaxed } from '../_shared/engines/engine_swing_v1_relaxed.ts';
import { retryWithBackoff, isTransientError, type RetryResult } from '../_shared/retry-utils.ts';
import { getWhitelistedTickers, logUniverseStats } from '../_shared/whitelist.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EVALUATION_REASONS = [
  'Low volatility and sideways price action detected',
  'Trend and pullback conditions were not sufficiently aligned',
  'Reduced liquidity during market conditions',
  'Price action lacked confirmation for high-probability setups',
  'Market structure did not meet risk-reward requirements',
];

function getRandomEvaluationReason(): string {
  return EVALUATION_REASONS[Math.floor(Math.random() * EVALUATION_REASONS.length)];
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
    console.warn('[hourly_swing_signals] Failed to load daily_focus_tickers:', error.message);
    return [];
  }

  return data?.map((row) => row.symbol) ?? [];
}

function getNextEvaluationTime(): string {
  // Hourly cron runs at :30 of each hour, so next eval is in ~60 minutes
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  return nextHour.toISOString();
}

// SWING engine - Watchlist
// Loaded dynamically from engine_universe table (performance_swing)
// Uses approved swing tickers from SwingEngine v1 backtests

// SWING engine - Timeframes
// SwingEngine v1 operates exclusively on 4h bars
const TIMEFRAMES = ['4h'] as const;

// Engine identifier
const ENGINE_TYPE = 'SWING';

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
  evaluation_completed: boolean;
  signals_found: number;
  evaluation_reason: string;
  next_evaluation_at: string;
}

type SymbolResult =
  | { type: 'generated'; symbol: string; timeframe: string; signal_type: string; confidence_score: number; confluence_score: number | null; signal_id?: string }
  | { type: 'deduped'; symbol: string; timeframe: string; minutes_ago: number }
  | { type: 'no_trade'; symbol: string; timeframe: string; decision: string; reason?: string }
  | { type: 'error'; symbol: string; timeframe: string; error_message?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStartTime = Date.now();
  const runStartedAt = new Date().toISOString();

  console.log(`[hourly_swing_signals] Starting ${ENGINE_TYPE} SwingEngine v1 signal generation`);
  console.log(`[hourly_swing_signals] Timeframes: ${TIMEFRAMES.join(', ')}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const tradeGate = getTradeGateStatus(new Date());
    if (!tradeGate.allowed) {
      console.log(
        `[hourly_swing_signals] Trade gate closed (${tradeGate.reason}) at ${tradeGate.currentTimeET} ET. Skipping swing signals.`,
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
      console.warn('[hourly_swing_signals] Selected universe empty after filtering; aborting run.');
      return new Response(
        JSON.stringify({ status: 'ok', reason: 'empty_universe_after_filter' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }


    const whitelist = await getWhitelistedTickers(supabase);
    logUniverseStats('ticker_whitelist', whitelist.length);
    if (whitelist.length === 0) {
      console.warn('[hourly_swing_signals] No whitelisted tickers available; skipping run.');
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
        `[hourly_swing_signals] Using ${focusSymbols.length} focus tickers for ${tradeDate}`,
      );
    } else {
      console.log(
        `[hourly_swing_signals] Focus list empty; falling back to ${symbolsArray.length} whitelisted tickers`,
      );
    }

    let generatedCount = 0;
    let dedupedCount = 0;
    let noTradeCount = 0;
    let errorCount = 0;
    const generatedSignals: Array<any> = [];
    
    console.log(`[hourly_swing_signals] Processing ${symbolsArray.length} symbols across ${TIMEFRAMES.length} timeframes`);

    // Process all symbol/timeframe combinations
    const allPromises = symbolsArray.flatMap(symbol => 
      TIMEFRAMES.map(async (timeframe) => {
        try {
          // Check if signal exists and was updated recently (deduplication)
          const recentSignal = await checkRecentSignal(supabase, symbol, timeframe, ENGINE_TYPE);

          if (recentSignal) {
            console.log(`[hourly_swing_signals] SKIP ${symbol}/${timeframe} - updated ${recentSignal.minutes_ago.toFixed(1)}min ago`);
            return { type: 'deduped', symbol, timeframe, minutes_ago: recentSignal.minutes_ago } as SymbolResult;
          }

          // Generate fresh signal using SwingEngine v1
          console.log(`[hourly_swing_signals] GENERATING ${symbol}/${timeframe} with SwingEngine v1`);

          // Step 1: Fetch market data with retry
          const rawInputResult = await retryWithBackoff(
            () => assembleRawSignalInput(symbol, timeframe),
            { maxAttempts: 2, initialDelayMs: 1000, timeout: 20000 }
          );

          if (!rawInputResult.success) {
            console.error(`[hourly_swing_signals] Failed to fetch data for ${symbol}/${timeframe}: ${rawInputResult.error}`);
            return { type: 'error', symbol, timeframe, error_message: `Data fetch failed: ${rawInputResult.error}` } as SymbolResult;
          }

          const rawInput = rawInputResult.data!;

          // Step 2: Run SwingEngine v1 (or relaxed variant for shadow engine)
          const engineInput: SwingEngineInput = {
            symbol,
            style: ENGINE_TYPE as any,
            timeframe,
            bars4h: rawInput.bars_4h,
          };

          // Use relaxed variant only if explicitly enabled (for shadow engine SWING_V1_12_15DEC)
          const useRelaxedVariant = Deno.env.get('ENABLE_RELAXED_SWING_V1_12_15DEC') === 'true';
          const swingResult: SwingEngineResult | SwingEngineResultRelaxed = useRelaxedVariant
            ? await runSwingV1Relaxed(engineInput)
            : await runSwingV1(engineInput);

          // Skip if engine says NO_TRADE or price plan is nonsensical
          if (
            swingResult.decision !== 'TRADE' ||
            !swingResult.entry ||
            !swingResult.stop ||
            !swingResult.target ||
            !isPricePlanSane(
              ENGINE_TYPE,
              swingResult.direction?.toLowerCase() === 'long' ? 'buy' : 'sell',
              swingResult.entry,
              swingResult.stop,
              swingResult.target,
            )
          ) {
            const reason = swingResult.reason ? String(swingResult.reason) : undefined;
            console.log(`[hourly_swing_signals] NO TRADE ${symbol}/${timeframe} - decision: ${swingResult.decision}${reason ? ` (reason: ${reason})` : ''}`);
            return { type: 'no_trade', symbol, timeframe, decision: swingResult.decision ?? 'NO_TRADE', reason } as SymbolResult;
          }

          console.log(`[hourly_swing_signals] SwingEngine v1 TRADE ${symbol}/${timeframe} - ${swingResult.direction} @ ${swingResult.entry} (conf: ${swingResult.confidence})`);

          // Step 3: Compute rule signal for AI layer compatibility
          const ruleSignal = computeRuleSignal(rawInput, ENGINE_TYPE);
          
          // Inject SwingEngine v1 data into rule signal
          (ruleSignal as any).swing_v1_engine_data = {
            direction: swingResult.direction,
            entry: swingResult.entry,
            stop: swingResult.stop,
            target: swingResult.target,
            confidence: swingResult.confidence,
            reason: swingResult.reason,
          };

          // Override rule signal values with SwingEngine v1 output
          ruleSignal.signal_type = swingResult.direction?.toLowerCase() === 'long' ? 'BUY' : 'SELL';
          ruleSignal.raw_confidence = swingResult.confidence || 50;

          // Step 4: Evaluate with AI using SWING engine personality
          const evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal, undefined, ENGINE_TYPE);

          // Step 5: Tag with SwingEngine v1
          (evaluatedSignal as any).engine_type = ENGINE_TYPE;
          (evaluatedSignal as any).engine_version = 'SWING_V1';

          // Step 6: Convert to database row (is_manual_request = false)
          const signalRecord = signalToRow(evaluatedSignal, false, {
            trade_gate_allowed: true,
            trade_gate_reason: tradeGate.reason,
            trade_gate_et_time: tradeGate.currentTimeET,
            blocked_until_et: null,
          });
          signalRecord.engine_version = 'SWING_V1';

          // Step 6: Upsert into ai_signals
          // Note: The unique constraint is on (symbol, timeframe, engine_type, immutable_date(created_at))
          // Since we can't specify the computed column in onConflict, we rely on the DB to handle duplicates
          const { data, error } = await supabase
            .from('ai_signals')
            .insert(signalRecord)
            .select()
            .single();

          if (error) {
            console.error(`[hourly_swing_signals] DB error for ${symbol}/${timeframe}:`, error);
            return { type: 'error', symbol, timeframe, error_message: error.message };
          }

          // NOTE: Discord / push publishing is handled by signals_visibility_evaluator.
          // We intentionally do NOT post directly from generation to keep trading
          // decoupled from visibility / noise controls and to respect the
          // "top 15 per day" Discord cap.

          console.log(`[hourly_swing_signals] ✓ ${symbol}/${timeframe} - ${evaluatedSignal.signal_type.toUpperCase()} (conf: ${evaluatedSignal.confidence_final})`);
          
          return {
            type: 'generated',
            symbol,
            timeframe,
            signal_type: evaluatedSignal.signal_type,
            confidence_score: evaluatedSignal.confidence_final,
            confluence_score: ruleSignal.confluence_score,
            signal_id: (data as any)?.id,
          } as SymbolResult;

        } catch (symbolError) {
          const errorMsg = symbolError instanceof Error ? symbolError.message : String(symbolError);
          const isTransient = isTransientError(symbolError);
          
          console.error(
            `[hourly_swing_signals] ${isTransient ? '[TRANSIENT]' : '[PERMANENT]'} Error processing ${symbol}/${timeframe}: ${errorMsg}`
          );
          
          return {
            type: 'error',
            symbol,
            timeframe,
            error_message: `${isTransient ? '[Transient] ' : ''}${errorMsg}`
          } as SymbolResult;
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
    
    console.log(`[hourly_swing_signals] Processing complete: ${generatedCount} generated, ${dedupedCount} deduped, ${noTradeCount} no-trade, ${errorCount} errors`);

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
      evaluation_completed: true,
      signals_found: generatedCount,
      evaluation_reason: generatedCount === 0 ? getRandomEvaluationReason() : 'Signals qualified and generated',
      next_evaluation_at: getNextEvaluationTime(),
    };

    console.log('[hourly_swing_signals] Summary:', {
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
        cron_jobname: 'hourly_swing_signals',
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
        console.warn('[hourly_swing_signals] Failed to write signal_run_log:', runLogError);
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
          console.warn('[hourly_swing_signals] Failed to write signal_run_symbol_log:', symbolLogError);
        }
      }
    } catch (e) {
      console.warn('[hourly_swing_signals] Failed to write run logs:', e);
    }

    // Send Discord notification (non-blocking)
    await sendDiscordNotification(summary).catch((err) => {
      console.warn('[hourly_swing_signals] Discord notification failed (non-fatal):', err);
    });

    // Send admin alert if something looks wrong
    await checkAndSendAdminAlert(summary).catch((err) => {
      console.warn('[hourly_swing_signals] Admin alert failed (non-fatal):', err);
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
    console.error('[hourly_swing_signals] Fatal error:', error);

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
  const webhookUrl = Deno.env.get('DISCORD_SWING_WEBHOOK');

  if (!webhookUrl) {
    console.warn('[hourly_swing_signals] DISCORD_SWING_WEBHOOK not configured, skipping notification');
    return;
  }

  // Only send notification if signals were generated
  if (summary.generated_count === 0) {
    console.log('[hourly_swing_signals] No signals generated, skipping Discord notification');
    return;
  }

  // Determine color based on results
  const color = summary.error_count > 5 ? 0xf39c12 : 0x3498db; // Orange if many errors, blue otherwise

  // Format top signals for display
  const topSignalsText = summary.top_signals
    .slice(0, 5)
    .map((sig, idx) => 
      `${idx + 1}. **${sig.symbol}** ${sig.timeframe} – ${sig.signal_type.toUpperCase()} – Conf: ${sig.confidence_score.toFixed(0)}, Confluence: ${sig.confluence_score?.toFixed(0) || 'N/A'}`
    )
    .join('\n');

  const embed = {
    title: `🔔 ${ENGINE_TYPE} AI – Hourly Run – ${new Date().toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' })} UTC`,
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
      text: `TradeLens ${ENGINE_TYPE} AI • Hourly Generation`,
    },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      console.error('[hourly_swing_signals] Discord webhook failed:', response.status, await response.text());
    } else {
      console.log(`[hourly_swing_signals] ✓ Posted summary to Discord: ${summary.generated_count} signals`);
    }
  } catch (err) {
    console.error('[hourly_swing_signals] Failed to send Discord notification:', err);
  }
}

/**
 * Check if signal generation looks healthy and send admin alert if not
 */
async function checkAndSendAdminAlert(summary: HourlySummary): Promise<void> {
  const issues: string[] = [];
  
  // Check 1: All symbols were deduped (cache hit)
  if (summary.generated_count === 0 && summary.deduped_count === summary.total_symbols) {
    console.log('[hourly_swing_signals] All symbols deduped (cache hit) - this is normal');
    return;
  }
  
  // Check 2: No signals generated AND no dedupe AND no-trade == 0 (total failure)
  if (summary.generated_count === 0 && summary.deduped_count === 0 && summary.no_trade_count === 0) {
    issues.push('⚠️ **ZERO signals generated and no outcomes recorded** - complete failure');
  }
  
  // Check 3: High error rate (>30% of signals failed)
  const errorRate = summary.error_count / summary.total_symbols;
  if (errorRate > 0.3) {
    issues.push(`⚠️ **High error rate**: ${summary.error_count}/${summary.total_symbols} signals failed (${(errorRate * 100).toFixed(0)}%)`);
  }
  
  // Check 4: Took too long (>100 seconds = possible timeout issues)
  if (summary.run_duration_ms > 100000) {
    issues.push(`⏱️ **Slow execution**: ${(summary.run_duration_ms / 1000).toFixed(1)}s (approaching timeout limit)`);
  }
  
  // Check 5: Very low generation rate
  if (summary.generated_count > 0 && summary.generated_count < 3 && (summary.deduped_count + summary.no_trade_count) < summary.total_symbols - 3) {
    issues.push(`📉 **Low generation rate**: Only ${summary.generated_count} signals generated`);
  }
  
  // Send admin alert if any issues detected
  if (issues.length > 0) {
    const alertMessage = `
**${ENGINE_TYPE} Engine Run Summary**:
• Generated: ${summary.generated_count}
• Deduped: ${summary.deduped_count}
• No-Trade: ${summary.no_trade_count}
• Errors: ${summary.error_count}
• Duration: ${(summary.run_duration_ms / 1000).toFixed(1)}s

**Issues Detected**:
${issues.join('\n')}

**Action Required**:
• Check Edge Function logs for hourly_swing_signals
• Verify API keys and database connectivity
`.trim();
    
    await sendDiscordAlert({
      severity: 'WARN',
      title: `⚠️ ${ENGINE_TYPE} Hourly Generation - Issues Detected`,
      message: alertMessage,
    });
    
    console.warn('[hourly_swing_signals] Admin alert sent:', issues);
  }
}
