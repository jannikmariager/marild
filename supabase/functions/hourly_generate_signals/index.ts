/**
 * Hourly Signal Generation Edge Function
 * 
 * Runs during US market hours (Mon-Fri, 12:30-21:30 UTC) to generate
 * AI trading signals for a curated list of US equities.
 * 
 * Schedule: '30 12-21 * * 1-5' (every hour at :30)
 * 
 * Features:
 * - Deduplication: Skips symbols with signals updated in last 55 minutes
 * - Real data pipeline: assembleRawSignalInput → computeRuleSignal → evaluateSignalWithAI
 * - Discord notifications: Posts summary with top signals
 * - Graceful error handling: Continues on individual symbol failures
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { assembleRawSignalInput } from '../_shared/signal_data_fetcher.ts';
import { computeRuleSignal } from '../_shared/signal_scorer.ts';
import { evaluateSignalWithAI } from '../_shared/signal_ai_evaluator.ts';
import { signalToRow } from '../_shared/signal_types.ts';
import { sendDiscordAlert } from '../_admin_shared/discord_helper.ts';
import { sendDiscordSignalNotification } from '../_shared/discord_signals_notifier.ts';
import { getTradeGateStatus } from '../_shared/trade_gate.ts';
import { getWhitelistedTickers, logUniverseStats } from '../_shared/whitelist.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Target symbols are fetched from approved_tickers table at runtime
// This ensures we scan ALL approved tickers from the admin dashboard

// Supported timeframes (start with 1h only)
const TIMEFRAMES = ['1h'] as const;
const ENGINE_VERSION = Deno.env.get('SWING_ENGINE_VERSION') ?? 'SWING_V1_EXPANSION';

// Cache window for deduplication (55 minutes)
const CACHE_WINDOW_MINUTES = 55;
// Minimum focus list size before we restrict the universe; otherwise fall back to full approved list
const MIN_FOCUS_SIZE = Number(Deno.env.get('FOCUS_MIN_LIST_SIZE') ?? '25');

interface HourlySummary {
  run_started_at: string;
  run_duration_ms: number;
  total_symbols: number;
  generated_count: number;
  skipped_count: number;
  error_count: number;
  top_signals: Array<{
    symbol: string;
    timeframe: string;
    signal_type: string;
    confidence_score: number;
    confluence_score: number | null;
    ai_confidence: number | null;
    smc_confidence: number | null;
    volume_confidence: number | null;
    sentiment_confidence: number | null;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStartTime = Date.now();
  const runStartedAt = new Date().toISOString();
  const tradeDate = new Date().toISOString().slice(0, 10);

  console.log('[hourly_generate_signals] Starting hourly signal generation');
  console.log(`[hourly_generate_signals] Timeframes: ${TIMEFRAMES.join(', ')}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const tradeGate = getTradeGateStatus(new Date());
    if (!tradeGate.allowed) {
      console.log(
        `[hourly_generate_signals] Trade gate closed (${tradeGate.reason}) at ${tradeGate.currentTimeET} ET. Skipping tradable signal generation.`,
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

    const whitelist = await getWhitelistedTickers(supabase);
    logUniverseStats('ticker_whitelist', whitelist.length);
    if (whitelist.length === 0) {
      console.warn('[hourly_generate_signals] No whitelisted tickers; exiting.');
      return new Response(
        JSON.stringify({ status: 'ok', reason: 'empty_whitelist', generated_count: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const whitelistSymbols = whitelist.map((row) => row.symbol);
    const whitelistSet = new Set(whitelistSymbols);

    // Check if we have a TOP focus list from pre-market sweep
    // If it exists, and large enough, use ranked subset; otherwise fall back to whitelist.
    const { data: focusTickers, error: focusError } = await supabase
      .from('daily_focus_tickers')
      .select('symbol, trade_date')
      .order('rank', { ascending: true });
    
    let symbolSource = 'ALL_APPROVED';
    let fullUniverse: string[] = [];
    
    const focusDate = focusTickers?.[0]?.trade_date ?? null;

    if (
      !focusError &&
      focusTickers &&
      focusTickers.length >= MIN_FOCUS_SIZE &&
      focusDate === tradeDate
    ) {
      // Use focus list only if it is large enough and from today; prevents collapse to tiny set
      fullUniverse = focusTickers
        .map((t) => t.symbol)
        .filter((symbol) => whitelistSet.has(symbol));
      symbolSource = `TOP_FOCUS_${focusTickers.length}`;
      console.log(
        `[hourly_generate_signals] Using focus list (${fullUniverse.length} symbols, trade_date=${focusDate}, min_size=${MIN_FOCUS_SIZE})`,
      );
    } else {
      // Fall back to entire whitelist (pre-market empty/too small/stale)
      console.log(
        `[hourly_generate_signals] Focus list unavailable/too small (size=${focusTickers?.length ?? 0}, date=${focusDate}); loading all whitelisted tickers`,
      );
      fullUniverse = whitelistSymbols;
    }
    
    if (fullUniverse.length === 0) {
      console.warn('[hourly_generate_signals] Selected universe is empty after filtering; exiting.');
      return new Response(
        JSON.stringify({ status: 'ok', reason: 'empty_universe_after_filter' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    console.log(`[hourly_generate_signals] Symbol source: ${symbolSource}`);
    console.log(`[hourly_generate_signals] Loaded ${fullUniverse.length} tickers`);
    console.log(`[hourly_generate_signals] Symbols: ${fullUniverse.join(', ')}`);

    // Shard universe into 4 batches based on minute-of-hour to stay within CPU limits.
    // Recommended crons (UTC): 34, 36, 38, 40 minutes past the hour.
    const now = new Date();
    const minute = now.getUTCMinutes();
    let batchIndex = 0;
    if (minute === 34) batchIndex = 0;
    else if (minute === 36) batchIndex = 1;
    else if (minute === 38) batchIndex = 2;
    else if (minute === 40) batchIndex = 3;
    else batchIndex = 0; // fallback if manually invoked or misaligned cron

    const NUM_BATCHES = 4;
    const shardSize = Math.ceil(fullUniverse.length / NUM_BATCHES);
    const startIdx = batchIndex * shardSize;
    const endIdx = startIdx + shardSize;
    const symbolsArray = fullUniverse.slice(startIdx, endIdx);

    console.log(
      `[hourly_generate_signals] Batch ${batchIndex + 1}/${NUM_BATCHES}: processing ${symbolsArray.length} tickers ` +
        `(indexes ${startIdx}-${Math.max(endIdx - 1, startIdx)})`,
    );

    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const generatedSignals: Array<any> = [];
    
    console.log(`[hourly_generate_signals] Processing ${symbolsArray.length} symbols in parallel`);

    // Process all symbols in parallel
    const allPromises = symbolsArray.map(async (symbol) => {
        for (const timeframe of TIMEFRAMES) {
          try {
            // Check if signal exists and was updated recently (deduplication)
            const recentSignal = await checkRecentSignal(supabase, symbol, timeframe);

            if (recentSignal) {
              console.log(`[hourly_generate_signals] SKIP ${symbol}/${timeframe} - updated ${recentSignal.minutes_ago.toFixed(1)}min ago`);
              return { type: 'skipped', symbol };
            }

            // Generate fresh signal
            console.log(`[hourly_generate_signals] GENERATING ${symbol}/${timeframe}`);

            // Step 1: Fetch all market data
            console.log(`[hourly_generate_signals] Step 1: Assembling raw input for ${symbol}...`);
            const rawInput = await assembleRawSignalInput(symbol, timeframe);
            console.log(`[hourly_generate_signals] Step 1 ✓ Raw input assembled`);

            // Step 2: Compute rule-based signal
            console.log(`[hourly_generate_signals] Step 2: Computing rule-based signal for ${symbol}...`);
            let ruleSignal: any;
            try {
              const ruleStart = Date.now();
              ruleSignal = computeRuleSignal(rawInput);
              const ruleTime = Date.now() - ruleStart;
              console.log(`[hourly_generate_signals] Step 2 ✓ Rule signal: ${ruleSignal.raw_signal_type} @ ${ruleSignal.raw_confidence}% (${ruleTime}ms)`);
            } catch (ruleError) {
              console.error(`[hourly_generate_signals] ❌ Step 2 FAILED - Rule scorer crashed for ${symbol}:`, ruleError);
              if (ruleError instanceof Error) console.error('  Error message:', ruleError.message);
              if (ruleError instanceof Error) console.error('  Stack:', ruleError.stack);
              throw ruleError;
            }

            // Step 3: Evaluate with AI
            console.log(`[hourly_generate_signals] Step 3: Evaluating with AI for ${symbol}...`);
            let evaluatedSignal: any;
            try {
              evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal);
              console.log(`[hourly_generate_signals] Step 3 ✓ AI evaluation complete`);
            } catch (evalError) {
              console.error(`[hourly_generate_signals] ❌ AI evaluation failed for ${symbol}:`, evalError);
              throw evalError;
            }

            // TEMPORARY: Treat hourly batch as SWING engine until multi-engine jobs are added
            (evaluatedSignal as any).engine_type = 'SWING';
            (evaluatedSignal as any).engine_version = ENGINE_VERSION;
            (evaluatedSignal as any).trading_style = 'swing';

            // Step 4: Convert to database row (is_manual_request = false)
            const signalRecord = signalToRow(evaluatedSignal, false, {
              trade_gate_allowed: true,
              trade_gate_reason: tradeGate.reason,
              trade_gate_et_time: tradeGate.currentTimeET,
              blocked_until_et: null,
            });

            // Step 5: Insert into ai_signals
            const { data, error } = await supabase
              .from('ai_signals')
              .insert(signalRecord)
              .select()
              .single();

            if (error) {
              console.error(`[hourly_generate_signals] DB error for ${symbol}/${timeframe}:`, error);
              return { type: 'error', symbol };
            }

            // NOTE: Discord / push publishing is handled by signals_visibility_evaluator.
            // We intentionally do NOT post directly from generation to keep trading
            // decoupled from visibility / noise controls.

            console.log(`[hourly_generate_signals] ✓ ${symbol}/${timeframe} - ${evaluatedSignal.signal_type.toUpperCase()} (conf: ${evaluatedSignal.confidence_final})`);
            
            return {
              type: 'generated',
              symbol,
              timeframe,
              signal_type: evaluatedSignal.signal_type,
              confidence_score: evaluatedSignal.confidence_final,
              confluence_score: ruleSignal.confluence_score,
              ai_confidence: evaluatedSignal.ai_confidence,
              smc_confidence: ruleSignal.confidence_smc,
              volume_confidence: ruleSignal.confidence_volume,
              sentiment_confidence: ruleSignal.confidence_sentiment,
            };

          } catch (symbolError) {
            const errorMsg = symbolError instanceof Error ? symbolError.message : String(symbolError);
            console.error(`[hourly_generate_signals] ❌ FAILED ${symbol}/${timeframe}: ${errorMsg}`);
            if (symbolError instanceof Error && symbolError.stack) {
              console.error(`[hourly_generate_signals] Stack trace:`, symbolError.stack);
            }
            return { type: 'error', symbol, error: errorMsg };
          }
        }
    });

    // Wait for all symbols to complete
    // Use Promise.allSettled instead of Promise.all to prevent one failure from crashing entire batch
    const allSettledResults = await Promise.allSettled(allPromises);
    
    // Convert PromiseSettledResult to actual results
    const allResults = allSettledResults.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`[hourly_generate_signals] Promise rejected for symbol ${idx}:`, result.reason);
        return { type: 'error', symbol: symbolsArray[idx] || 'unknown' };
      }
    });
    
    // Aggregate results
    for (const result of allResults) {
      if (result && result.type === 'generated') {
        generatedCount++;
        generatedSignals.push(result);
      } else if (result && result.type === 'skipped') {
        skippedCount++;
      } else if (result && result.type === 'error') {
        errorCount++;
      }
    }
    
    // Log failed tickers explicitly
    const failedTickers = allResults
      .filter(r => r && r.type === 'error')
      .map(r => r.symbol);
    
    if (failedTickers.length > 0) {
      console.warn(`[hourly_generate_signals] ⚠️  Failed tickers (${failedTickers.length}): ${failedTickers.join(', ')}`);
    }
    
    console.log(`[hourly_generate_signals] Processing complete: ${generatedCount} generated, ${skippedCount} skipped, ${errorCount} errors`);

    const runDurationMs = Date.now() - runStartTime;

    // Build summary object
    const summary: HourlySummary = {
      run_started_at: runStartedAt,
      run_duration_ms: runDurationMs,
      total_symbols: symbolsArray.length * TIMEFRAMES.length,
      generated_count: generatedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
      top_signals: generatedSignals
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, 10), // Top 10 by confidence
    };

    // Send lightweight coverage status to admin alerts channel (per-batch)
    try {
      const universeSize = symbolsArray.length;
      const activeSymbols = new Set(
        generatedSignals.map((s: any) => s.symbol)
      ).size;

      const coveragePct = universeSize > 0
        ? ((activeSymbols / universeSize) * 100).toFixed(1)
        : '0.0';

      await sendDiscordAlert({
        severity: 'INFO',
        title: 'Hourly SWING signal coverage',
        message:
          `Generated signals for ${activeSymbols}/${universeSize} tickers in universe (${coveragePct}% coverage).` +
          `\nDetails: ${generatedCount} new signals • ${skippedCount} skipped (recent) • ${errorCount} errors.`,
      });
    } catch (e) {
      console.warn('[hourly_generate_signals] Failed to send coverage status alert:', e);
    }

    console.log('[hourly_generate_signals] Summary:', {
      generated: generatedCount,
      skipped: skippedCount,
      errors: errorCount,
      duration_sec: (runDurationMs / 1000).toFixed(1),
    });

    // Send Discord notification (non-blocking)
    await sendDiscordNotification(summary).catch((err) => {
      console.warn('[hourly_generate_signals] Discord notification failed (non-fatal):', err);
    });

    // Send admin alert if something looks wrong
    await checkAndSendAdminAlert(summary).catch((err) => {
      console.warn('[hourly_generate_signals] Admin alert failed (non-fatal):', err);
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
    console.error('[hourly_generate_signals] Fatal error:', error);

    // Send critical alert to Discord
    await sendDiscordAlert({
      severity: 'CRITICAL',
      title: 'Hourly Signal Generation Failed',
      message: error.message || 'Unknown error',
      context: {
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
 * Check if a signal for this symbol/timeframe was updated recently
 * Returns null if signal is stale or doesn't exist
 */
async function checkRecentSignal(
  supabase: any,
  symbol: string,
  timeframe: string
): Promise<{ minutes_ago: number } | null> {
  // IMPORTANT:
  // Only consider *automatic* SWING 1h signals from the performance engine for deduplication.
  // Previously we looked at ANY ai_signals row for the symbol/timeframe, including:
  // - Manual on-demand requests (is_manual_request = true)
  // - Other engines (DAYTRADER / INVESTOR)
  // That caused most tickers to be skipped if they had *any* recent signal,
  // so the hourly job kept generating signals on the same small subset.
  const { data, error } = await supabase
    .from('ai_signals')
    .select('updated_at')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('engine_type', 'SWING')
    .eq('is_manual_request', false)
    .or('trade_gate_allowed.is.null,trade_gate_allowed.eq.true')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null; // No auto SWING signal found
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

// Note: postSignalToDiscord removed - now uses shared sendDiscordSignalNotification
// which includes proper disclaimer and premium formatting

/**
 * Send formatted Discord notification with run summary
 */
async function sendDiscordNotification(summary: HourlySummary): Promise<void> {
  const webhookUrl = Deno.env.get('DISCORD_SIGNALS_WEBHOOK');

  if (!webhookUrl) {
    console.warn('[hourly_generate_signals] DISCORD_SIGNALS_WEBHOOK not configured, skipping notification');
    return;
  }

  // Only send notification if signals were generated (skip boring "0 generated" notifications)
  if (summary.generated_count === 0) {
    console.log('[hourly_generate_signals] No signals generated, skipping Discord notification');
    return;
  }

  // Determine color based on results
  const color = summary.error_count > 5 ? 0xf39c12 : 0x3498db; // Orange if many errors, blue otherwise

  // Format top signals for display
  const topSignalsText = summary.top_signals
    .slice(0, 5) // Show top 5 in Discord
    .map((sig, idx) => 
      `${idx + 1}. **${sig.symbol}** ${sig.timeframe} – ${sig.signal_type.toUpperCase()} – Conf: ${sig.confidence_score.toFixed(0)}, Confluence: ${sig.confluence_score?.toFixed(0) || 'N/A'}`
    )
    .join('\n');

  const embed = {
    title: `🔔 Hourly AI Signal Run – ${new Date().toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' })} UTC`,
    description: `**Generated**: ${summary.generated_count} ✅ • **Skipped**: ${summary.skipped_count} ⏭️ • **Errors**: ${summary.error_count} ${summary.error_count > 0 ? '⚠️' : ''}`,
    color: color,
    fields: [
      {
        name: '📊 Top Signals',
        value: topSignalsText || 'No signals generated',
        inline: false,
      },
      {
        name: '⏱️ Performance',
        value: `Duration: ${(summary.run_duration_ms / 1000).toFixed(1)}s • Total Symbols: ${summary.total_symbols}`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'TradeLens AI • Hourly Signal Generation',
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
      console.error('[hourly_generate_signals] Discord webhook failed:', response.status, await response.text());
    } else {
      console.log(`[hourly_generate_signals] ✓ Posted summary to Discord: ${summary.generated_count} signals`);
    }
  } catch (err) {
    console.error('[hourly_generate_signals] Failed to send Discord notification:', err);
  }
}

/**
 * Check if signal generation looks healthy and send admin alert if not
 */
async function checkAndSendAdminAlert(summary: HourlySummary): Promise<void> {
  const issues: string[] = [];
  
  // Check 1: All signals were skipped (nothing generated)
  if (summary.generated_count === 0 && summary.skipped_count === summary.total_symbols) {
    // This is normal if signals were recently generated (within 55min cache window)
    // But if it happens on multiple consecutive runs, it could indicate a problem
    console.log('[hourly_generate_signals] All signals skipped (cache hit) - this is normal');
    // Don't alert for now, as this is expected behavior
    return;
  }
  
  // Check 2: No signals generated AND no signals skipped (total failure)
  if (summary.generated_count === 0 && summary.skipped_count === 0) {
    issues.push('⚠️ **ZERO signals generated or skipped** - complete failure');
  }
  
  // Check 3: High error rate (>30% of symbols failed)
  const errorRate = summary.error_count / summary.total_symbols;
  if (errorRate > 0.3) {
    issues.push(`⚠️ **High error rate**: ${summary.error_count}/${summary.total_symbols} symbols failed (${(errorRate * 100).toFixed(0)}%)`);
  }
  
  // Check 4: Took too long (>90 seconds = possible timeout issues)
  if (summary.run_duration_ms > 90000) {
    issues.push(`⏱️ **Slow execution**: ${(summary.run_duration_ms / 1000).toFixed(1)}s (approaching 120s timeout limit)`);
  }
  
  // Check 5: Very low generation rate when not all skipped
  if (summary.generated_count > 0 && summary.generated_count < 3 && summary.skipped_count < summary.total_symbols - 3) {
    issues.push(`📉 **Low generation rate**: Only ${summary.generated_count} signals generated, ${summary.skipped_count} skipped, ${summary.error_count} errors`);
  }
  
  // Send admin alert if any issues detected
  if (issues.length > 0) {
    const alertMessage = `
**Run Summary**:
• Generated: ${summary.generated_count}
• Skipped: ${summary.skipped_count}
• Errors: ${summary.error_count}
• Duration: ${(summary.run_duration_ms / 1000).toFixed(1)}s

**Issues Detected**:
${issues.join('\n')}

**Action Required**:
• Check Edge Function logs: https://supabase.com/dashboard/project/gwacnidnscugvwxhchsm/functions/hourly_generate_signals/logs
• Verify API keys (Yahoo Finance, OpenAI, Finnhub)
• Check database connectivity
• Review recent deployments
`.trim();
    
    await sendDiscordAlert({
      severity: 'WARN',
      title: '⚠️ Hourly Signal Generation - Issues Detected',
      message: alertMessage,
    });
    
    console.warn('[hourly_generate_signals] Admin alert sent:', issues);
  }
}
