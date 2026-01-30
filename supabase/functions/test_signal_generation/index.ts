/**
 * Test Signal Generation - Quick 3-Symbol Test
 * 
 * Simplified version to test Yahoo v8 client integration
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { assembleRawSignalInput } from '../_shared/signal_data_fetcher.ts';
import { computeRuleSignal } from '../_shared/signal_scorer.ts';
import { evaluateSignalWithAI } from '../_shared/signal_ai_evaluator.ts';
import { signalToRow } from '../_shared/signal_types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Test with just 3 symbols
const TEST_SYMBOLS = ['AAPL', 'MSFT', 'NVDA'] as const;
const TIMEFRAMES = ['1h'] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStartTime = Date.now();
  console.log('[test_signal_generation] Starting with 3 symbols');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let generatedCount = 0;
    let errorCount = 0;
    const results: Array<any> = [];

    for (const symbol of TEST_SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        try {
          console.log(`[test] Processing ${symbol}/${timeframe}...`);
          
          // Step 1: Fetch all market data
          console.log(`[test] Step 1: Calling assembleRawSignalInput...`);
          const rawInput = await assembleRawSignalInput(symbol, timeframe);
          console.log(`[test] ✓ Data fetched for ${symbol}`);

          // Step 2: Compute rule-based signal
          console.log(`[test] Step 2: Computing rule signal...`);
          const ruleSignal = computeRuleSignal(rawInput);
          console.log(`[test] ✓ Rule signal computed for ${symbol}`);

          // Step 3: Evaluate with AI
          console.log(`[test] Step 3: Evaluating with AI...`);
          const evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal);
          console.log(`[test] ✓ AI evaluation complete for ${symbol}`);

          // Step 4: Convert to database row
          console.log(`[test] Step 4: Converting to database row...`);
          const signalRecord = signalToRow(evaluatedSignal, false);

          // Step 5: Upsert into ai_signals
          console.log(`[test] Step 5: Upserting to database...`);
          const { data, error } = await supabase
            .from('ai_signals')
            .upsert(signalRecord, {
              onConflict: 'symbol,timeframe',
            })
            .select()
            .single();

          if (error) {
            console.error(`[test] DB error for ${symbol}:`, error);
            errorCount++;
            continue;
          }

          generatedCount++;
          results.push({
            symbol,
            signal_type: evaluatedSignal.signal_type,
            confidence_score: evaluatedSignal.confidence_final,
          });

          console.log(`[test] ✓✓✓ ${symbol} COMPLETE - ${evaluatedSignal.signal_type.toUpperCase()} (${evaluatedSignal.confidence_final})`);

        } catch (symbolError) {
          console.error(`[test] ❌ ERROR processing ${symbol}:`);
          console.error(`[test] Error name: ${symbolError.name}`);
          console.error(`[test] Error message: ${symbolError.message}`);
          console.error(`[test] Error stack: ${symbolError.stack}`);
          results.push({
            symbol,
            error: symbolError.message,
          });
          errorCount++;
        }
      }
    }

    const runDurationMs = Date.now() - runStartTime;

    return new Response(
      JSON.stringify({
        status: 'completed',
        test_mode: true,
        symbols_tested: TEST_SYMBOLS.length,
        generated_count: generatedCount,
        error_count: errorCount,
        run_duration_ms: runDurationMs,
        run_duration_seconds: (runDurationMs / 1000).toFixed(1),
        signals: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[test] Fatal error:', error);

    return new Response(
      JSON.stringify({
        status: 'error',
        error: error.message || 'Unknown error',
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
