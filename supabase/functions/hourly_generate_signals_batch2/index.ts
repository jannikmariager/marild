/**
 * Hourly Signal Generation Edge Function
 * 
 * Runs during US market hours (Mon-Fri, 12:30-21:30 UTC) to generate
 * AI trading signals for a curated list of US equities.
 * 
 * Schedule: '32 12-21 * * 1-5' (every hour at :32, 2 min after batch 1)
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Target symbols are fetched from approved_tickers table at runtime
// NOTE: This batch2 function is now redundant since batch1 scans all approved tickers
// Keeping it for backward compatibility but it will skip symbols already processed

// Supported timeframes (start with 1h only)
const TIMEFRAMES = ['1h'] as const;
const ENGINE_VERSION = Deno.env.get('SWING_ENGINE_VERSION') ?? 'SWING_V1_EXPANSION';

// Cache window for deduplication (55 minutes)
const CACHE_WINDOW_MINUTES = 55;

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

  console.log('[hourly_generate_signals_batch2] Starting (DEPRECATED - batch1 now handles all symbols)');
  console.log('[hourly_generate_signals_batch2] This function is now redundant since batch1 scans all approved_tickers');
  
  // Return early - batch1 already handles all approved tickers
  return new Response(
    JSON.stringify({
      status: 'skipped',
      message: 'Batch2 is deprecated - batch1 now scans all approved tickers from database',
      note: 'You can safely remove this cron job',
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const generatedSignals: Array<any> = [];

    // Process all symbols in parallel (small enough set to complete within timeout)
    // Each symbol takes ~5-10s, so 10 symbols = ~50-100s total (well under 120s limit)
    const symbolsArray = Array.from(TARGET_SYMBOLS);
    
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
            const rawInput = await assembleRawSignalInput(symbol, timeframe);

            // Step 2: Compute rule-based signal
            const ruleSignal = computeRuleSignal(rawInput);

            // Step 3: Evaluate with AI
            const evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal);

            // TEMPORARY: Treat hourly batch2 as SWING engine until multi-engine jobs are added
            (evaluatedSignal as any).engine_type = 'SWING';
            (evaluatedSignal as any).engine_version = ENGINE_VERSION;

            // Step 4: Convert to database row (is_manual_request = false)
            const signalRecord = signalToRow(evaluatedSignal, false);

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

            // Post individual signal to Discord (non-blocking)
            try {
              await sendDiscordSignalNotification(data, 'hourly');
            } catch (e) {
              console.warn(`[hourly_generate_signals_batch2] Discord per-signal post failed for ${symbol}/${timeframe}:`, e);
            }

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
            console.error(`[hourly_generate_signals] Error processing ${symbol}/${timeframe}:`, symbolError);
            return { type: 'error', symbol };
          }
        }
    });

    // Wait for all symbols to complete
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
    
    console.log(`[hourly_generate_signals] Processing complete: ${generatedCount} generated, ${skippedCount} skipped, ${errorCount} errors`);

    const runDurationMs = Date.now() - runStartTime;

    // Build summary object
    const summary: HourlySummary = {
      run_started_at: runStartedAt,
      run_duration_ms: runDurationMs,
      total_symbols: TARGET_SYMBOLS.length * TIMEFRAMES.length,
      generated_count: generatedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
      top_signals: generatedSignals
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, 10), // Top 10 by confidence
    };

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
  const { data, error } = await supabase
    .from('ai_signals')
    .select('updated_at')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
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

// Note: postSignalToDiscord removed - now uses shared sendDiscordSignalNotification
// which includes proper disclaimer and premium formatting

/*
async function postSignalToDiscord_DEPRECATED(dbRow: any, evaluatedSignal: any): Promise<void> {
  const webhookUrl = Deno.env.get('DISCORD_SIGNALS_WEBHOOK');
  
  if (!webhookUrl) {
    console.warn('[postSignalToDiscord] DISCORD_SIGNALS_WEBHOOK not configured');
    return;
  }

  const signalEmoji = dbRow.signal_type === 'buy' ? '🟢' : dbRow.signal_type === 'sell' ? '🔴' : '⚪';
  const signalColor = dbRow.signal_type === 'buy' ? 0x00ff7f : dbRow.signal_type === 'sell' ? 0xff4c4c : 0xffd700;

  const embed = {
    title: `🤖 ${dbRow.symbol} ${dbRow.timeframe.toUpperCase()} Signal`,
    description: `${signalEmoji} **${dbRow.signal_type.toUpperCase()}** Signal Generated`,
    color: signalColor,
    fields: [
      {
        name: '📊 Confidence',
        value: `${Math.round(dbRow.confidence_score)}%`,
        inline: true,
      },
      {
        name: '🔗 Confluence',
        value: `${Math.round(dbRow.confluence_score || 0)}%`,
        inline: true,
      },
      {
        name: '⚠️ Risk',
        value: `${Math.round(dbRow.correction_risk)}%`,
        inline: true,
      },
      {
        name: '💰 Entry',
        value: `$${dbRow.entry_price?.toFixed(2) || 'N/A'}`,
        inline: true,
      },
      {
        name: '🛑 Stop Loss',
        value: `$${dbRow.stop_loss?.toFixed(2) || 'N/A'}`,
        inline: true,
      },
      {
        name: '🎯 Target',
        value: `$${dbRow.take_profit_1?.toFixed(2) || 'N/A'}`,
        inline: true,
      },
    ],
    footer: {
      text: 'TradeLens AI • Automated Signal',
    },
    timestamp: new Date().toISOString(),
  };

  // Add reasoning if available
  if (dbRow.reasoning) {
    embed.fields.push({
      name: '📝 Analysis',
      value: dbRow.reasoning.slice(0, 200) + (dbRow.reasoning.length > 200 ? '...' : ''),
      inline: false,
    });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      console.error(`[postSignalToDiscord] Failed: ${response.status}`, await response.text());
    } else {
      console.log(`[postSignalToDiscord] ✓ Posted ${dbRow.symbol} ${dbRow.timeframe}`);
    }
  } catch (err) {
    console.error('[postSignalToDiscord] Error:', err);
  }
}

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
