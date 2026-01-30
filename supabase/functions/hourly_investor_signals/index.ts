/**
 * Hourly INVESTOR Engine Signal Generation
 * 
 * Generates signals for the INVESTOR AI engine
 * - Timeframes: 1D, 1W
 * - Schedule: '35 12-21 * * 1-5' (every hour at :35 during market hours)
 * - Target: Long-term investors holding positions for months to years
 * 
 * Features:
 * - Engine-specific watchlist and timeframes
 * - Deduplication: Skips symbols updated in last 55 minutes
 * - Discord: Routes to INVESTOR engine webhook channel
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


// INVESTOR AI - Timeframes
// 1D for position timing, 1W for macro trends
const TIMEFRAMES = ['1d', '1w'] as const;

// Engine identifier
const ENGINE_TYPE = 'INVESTOR';
const ENGINE_VERSION = 'INVESTOR_V1';

// Cache window for deduplication (55 minutes)
const CACHE_WINDOW_MINUTES = 55;

interface HourlySummary {
  engine_type: string;
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
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStartTime = Date.now();
  const runStartedAt = new Date().toISOString();

  console.log(`[hourly_investor_signals] Starting ${ENGINE_TYPE} engine signal generation`);
  console.log(`[hourly_investor_signals] Timeframes: ${TIMEFRAMES.join(', ')}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const tradeGate = getTradeGateStatus(new Date());
    if (!tradeGate.allowed) {
      console.log(
        `[hourly_investor_signals] Trade gate closed (${tradeGate.reason}) at ${tradeGate.currentTimeET} ET. Skipping investor signals.`,
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
      console.warn('[hourly_investor_signals] No whitelisted tickers; skipping run.');
      return new Response(
        JSON.stringify({ status: 'ok', reason: 'empty_whitelist' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const symbolsArray = whitelist.map((row) => row.symbol);
    console.log(`[hourly_investor_signals] Loaded ${symbolsArray.length} whitelisted symbols`);

    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const generatedSignals: Array<any> = [];

    console.log(`[hourly_investor_signals] Processing ${symbolsArray.length} symbols across ${TIMEFRAMES.length} timeframes`);

    // Process all symbol/timeframe combinations
    const allPromises = symbolsArray.flatMap(symbol => 
      TIMEFRAMES.map(async (timeframe) => {
        try {
          // Check if signal exists and was updated recently (deduplication)
          const recentSignal = await checkRecentSignal(supabase, symbol, timeframe, ENGINE_TYPE);

          if (recentSignal) {
            console.log(`[hourly_investor_signals] SKIP ${symbol}/${timeframe} - updated ${recentSignal.minutes_ago.toFixed(1)}min ago`);
            return { type: 'skipped', symbol, timeframe };
          }

          // Generate fresh signal
          console.log(`[hourly_investor_signals] GENERATING ${symbol}/${timeframe}`);

          // Step 1: Fetch all market data
          const rawInput = await assembleRawSignalInput(symbol, timeframe);

            // Step 2: Compute rule-based signal with INVESTOR engine
            const ruleSignal = computeRuleSignal(rawInput, ENGINE_TYPE);

            // Step 3: STRICT risk rejection for INVESTOR (risk > 50 = auto-reject)
            if (ruleSignal.risk_should_reject) {
              console.log(`[hourly_investor_signals] RISK REJECTED ${symbol}/${timeframe} - risk: ${ruleSignal.correction_risk}% (>${50}) [INVESTOR HARD LIMIT]`);
              return { type: 'skipped', symbol, timeframe }; // Skipped, not error (intentional)
            }

            // Step 4: Check minimum confidence threshold (INVESTOR requires 45+)
            if (ruleSignal.raw_confidence < 45) {
              console.log(`[hourly_investor_signals] CONFIDENCE TOO LOW ${symbol}/${timeframe} - conf: ${ruleSignal.raw_confidence}% (<45)`);
              return { type: 'skipped', symbol, timeframe };
            }

            // Step 5: Evaluate with AI using INVESTOR engine personality (fundamentals-first)
            const evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal, undefined, ENGINE_TYPE);

            // Step 6: Tag with INVESTOR engine type/version
            (evaluatedSignal as any).engine_type = ENGINE_TYPE;
            (evaluatedSignal as any).engine_version = ENGINE_VERSION;

          // Step 5: Convert to database row (is_manual_request = false)
          const signalRecord = signalToRow(evaluatedSignal, false, {
            trade_gate_allowed: true,
            trade_gate_reason: tradeGate.reason,
            trade_gate_et_time: tradeGate.currentTimeET,
            blocked_until_et: null,
          });

          // Step 6: Insert into ai_signals
          // Note: The unique constraint is on (symbol, timeframe, engine_type, immutable_date(created_at))
          // Since we can't specify the computed column in onConflict, we rely on the DB to handle duplicates
          const { data, error } = await supabase
            .from('ai_signals')
            .insert(signalRecord)
            .select()
            .single();

          if (error) {
            console.error(`[hourly_investor_signals] DB error for ${symbol}/${timeframe}:`, error);
            return { type: 'error', symbol, timeframe };
          }

          // Post individual signal to Discord (routed to INVESTOR webhook)
          try {
            await sendDiscordSignalNotification(data, 'hourly');
          } catch (e) {
            console.warn(`[hourly_investor_signals] Discord post failed for ${symbol}/${timeframe}:`, e);
          }

          console.log(`[hourly_investor_signals] ✓ ${symbol}/${timeframe} - ${evaluatedSignal.signal_type.toUpperCase()} (conf: ${evaluatedSignal.confidence_final})`);
          
          return {
            type: 'generated',
            symbol,
            timeframe,
            signal_type: evaluatedSignal.signal_type,
            confidence_score: evaluatedSignal.confidence_final,
            confluence_score: ruleSignal.confluence_score,
          };

        } catch (symbolError) {
          console.error(`[hourly_investor_signals] Error processing ${symbol}/${timeframe}:`, symbolError);
          return { type: 'error', symbol, timeframe };
        }
      })
    );

    // Wait for all signals to complete
    const allResults = await Promise.all(allPromises);
    
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
    
    console.log(`[hourly_investor_signals] Processing complete: ${generatedCount} generated, ${skippedCount} skipped, ${errorCount} errors`);

    const runDurationMs = Date.now() - runStartTime;

    // Build summary object
    const summary: HourlySummary = {
      engine_type: ENGINE_TYPE,
      run_started_at: runStartedAt,
      run_duration_ms: runDurationMs,
      total_symbols: symbolsArray.length * TIMEFRAMES.length,
      generated_count: generatedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
      top_signals: generatedSignals
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, 10),
    };

    console.log('[hourly_investor_signals] Summary:', {
      engine: ENGINE_TYPE,
      generated: generatedCount,
      skipped: skippedCount,
      errors: errorCount,
      duration_sec: (runDurationMs / 1000).toFixed(1),
    });

    // Send Discord notification (non-blocking)
    await sendDiscordNotification(summary).catch((err) => {
      console.warn('[hourly_investor_signals] Discord notification failed (non-fatal):', err);
    });

    // Send admin alert if something looks wrong
    await checkAndSendAdminAlert(summary).catch((err) => {
      console.warn('[hourly_investor_signals] Admin alert failed (non-fatal):', err);
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
    console.error('[hourly_investor_signals] Fatal error:', error);

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
  const webhookUrl = Deno.env.get('DISCORD_INVESTOR_WEBHOOK');

  if (!webhookUrl) {
    console.warn('[hourly_investor_signals] DISCORD_INVESTOR_WEBHOOK not configured, skipping notification');
    return;
  }

  // Only send notification if signals were generated
  if (summary.generated_count === 0) {
    console.log('[hourly_investor_signals] No signals generated, skipping Discord notification');
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
      console.error('[hourly_investor_signals] Discord webhook failed:', response.status, await response.text());
    } else {
      console.log(`[hourly_investor_signals] ✓ Posted summary to Discord: ${summary.generated_count} signals`);
    }
  } catch (err) {
    console.error('[hourly_investor_signals] Failed to send Discord notification:', err);
  }
}

/**
 * Check if signal generation looks healthy and send admin alert if not
 */
async function checkAndSendAdminAlert(summary: HourlySummary): Promise<void> {
  const issues: string[] = [];
  
  // Check 1: All signals were skipped (nothing generated)
  if (summary.generated_count === 0 && summary.skipped_count === summary.total_symbols) {
    console.log('[hourly_investor_signals] All signals skipped (cache hit) - this is normal');
    return;
  }
  
  // Check 2: No signals generated AND no signals skipped (total failure)
  if (summary.generated_count === 0 && summary.skipped_count === 0) {
    issues.push('⚠️ **ZERO signals generated or skipped** - complete failure');
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
  if (summary.generated_count > 0 && summary.generated_count < 3 && summary.skipped_count < summary.total_symbols - 3) {
    issues.push(`📉 **Low generation rate**: Only ${summary.generated_count} signals generated`);
  }
  
  // Send admin alert if any issues detected
  if (issues.length > 0) {
    const alertMessage = `
**${ENGINE_TYPE} Engine Run Summary**:
• Generated: ${summary.generated_count}
• Skipped: ${summary.skipped_count}
• Errors: ${summary.error_count}
• Duration: ${(summary.run_duration_ms / 1000).toFixed(1)}s

**Issues Detected**:
${issues.join('\n')}

**Action Required**:
• Check Edge Function logs for hourly_investor_signals
• Verify API keys and database connectivity
`.trim();
    
    await sendDiscordAlert({
      severity: 'WARN',
      title: `⚠️ ${ENGINE_TYPE} Hourly Generation - Issues Detected`,
      message: alertMessage,
    });
    
    console.warn('[hourly_investor_signals] Admin alert sent:', issues);
  }
}
