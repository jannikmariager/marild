/**
 * Swing Fav8 Shadow Engine
 *
 * Fixed 8-ticker universe (AVGO, AMD, AAPL, NVDA, COIN, NFLX, MARA, TSLA)
 * Uses SwingEngine V1 relaxed variant (Dec 12–15 config) with:
 * - Confluence floor 50 (caps risk penalty to 20 via correction_risk formula)
 * - risk_penalty_cap effect without touching global scorer
 *
 * Timeframe: 4h
 * Schedule: run hourly during market hours via pg_cron
 * Run mode: SHADOW (writes to ai_signals with engine_version SWING_FAV8_SHADOW)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { assembleRawSignalInput } from '../_shared/signal_data_fetcher.ts';
import { computeRuleSignal } from '../_shared/signal_scorer.ts';
import { evaluateSignalWithAI } from '../_shared/signal_ai_evaluator.ts';
import { signalToRow, isPricePlanSane } from '../_shared/signal_types.ts';
import { getTradeGateStatus } from '../_shared/trade_gate.ts';
import { runSwingV1Relaxed, type SwingEngineInput, type SwingEngineResult as SwingEngineResultRelaxed } from '../_shared/engines/engine_swing_v1_relaxed.ts';
import { retryWithBackoff, isTransientError, type RetryResult } from '../_shared/retry-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIMEFRAMES = ['4h'] as const;
const ENGINE_TYPE = 'SWING';
const ENGINE_VERSION = 'SWING_FAV8_SHADOW';
const SYMBOLS = ['AVGO', 'AMD', 'AAPL', 'NVDA', 'COIN', 'NFLX', 'MARA', 'TSLA'];
const CACHE_WINDOW_MINUTES = 55;

interface HourlySummary {
  engine_version: string;
  run_started_at: string;
  run_duration_ms: number;
  total_symbols: number;
  generated_count: number;
  deduped_count: number;
  no_trade_count: number;
  error_count: number;
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

  console.log(`[swing_fav8_shadow] Starting ${ENGINE_VERSION} generation`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const tradeGate = getTradeGateStatus(new Date());
    if (!tradeGate.allowed) {
      console.log(`[swing_fav8_shadow] Trade gate closed (${tradeGate.reason}) ${tradeGate.currentTimeET} ET`);
      return new Response(
        JSON.stringify({
          status: 'gate_blocked',
          reason: tradeGate.reason,
          currentTimeET: tradeGate.currentTimeET,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const symbolsArray = SYMBOLS;
    let generatedCount = 0;
    let dedupedCount = 0;
    let noTradeCount = 0;
    let errorCount = 0;

    console.log(`[swing_fav8_shadow] Processing ${symbolsArray.length} symbols`);

    const allPromises = symbolsArray.flatMap(symbol =>
      TIMEFRAMES.map(async (timeframe) => {
        try {
          const recentSignal = await checkRecentSignal(supabase, symbol, timeframe, ENGINE_TYPE);
          if (recentSignal) {
            console.log(`[swing_fav8_shadow] SKIP ${symbol}/${timeframe} - updated ${recentSignal.minutes_ago.toFixed(1)}min ago`);
            return { type: 'deduped', symbol, timeframe, minutes_ago: recentSignal.minutes_ago } as SymbolResult;
          }

          const rawInputResult = await retryWithBackoff(
            () => assembleRawSignalInput(symbol, timeframe),
            { maxAttempts: 2, initialDelayMs: 1000, timeout: 20000 }
          );

          if (!rawInputResult.success) {
            console.error(`[swing_fav8_shadow] Data fetch failed for ${symbol}/${timeframe}: ${rawInputResult.error}`);
            return { type: 'error', symbol, timeframe, error_message: `Data fetch failed: ${rawInputResult.error}` } as SymbolResult;
          }

          const rawInput = rawInputResult.data!;

          // Swing relaxed engine (Dec 12–15 profile)
          const engineInput: SwingEngineInput = {
            symbol,
            style: ENGINE_TYPE as any,
            timeframe,
            bars4h: rawInput.bars_4h,
          };
          const swingResult: SwingEngineResultRelaxed = await runSwingV1Relaxed(engineInput);

          if (
            swingResult.decision !== 'TRADE' ||
            !swingResult.entry ||
            !swingResult.stop ||
            !swingResult.target ||
            !isPricePlanSane(
              ENGINE_TYPE as any,
              swingResult.direction?.toLowerCase() === 'long' ? 'buy' : 'sell',
              swingResult.entry,
              swingResult.stop,
              swingResult.target,
            )
          ) {
            const reason = swingResult.reason ? String(swingResult.reason) : undefined;
            console.log(`[swing_fav8_shadow] NO TRADE ${symbol}/${timeframe} - ${reason ?? 'no_setup'}`);
            return { type: 'no_trade', symbol, timeframe, decision: swingResult.decision ?? 'NO_TRADE', reason } as SymbolResult;
          }

          console.log(`[swing_fav8_shadow] TRADE ${symbol}/${timeframe} - ${swingResult.direction} @ ${swingResult.entry} (conf: ${swingResult.confidence})`);

          // Rule signal + confluence floor to cap risk penalty
          const ruleSignal = computeRuleSignal(rawInput, ENGINE_TYPE);
          (ruleSignal as any).swing_v1_engine_data = {
            direction: swingResult.direction,
            entry: swingResult.entry,
            stop: swingResult.stop,
            target: swingResult.target,
            confidence: swingResult.confidence,
            reason: swingResult.reason,
          };
          ruleSignal.signal_type = swingResult.direction?.toLowerCase() === 'long' ? 'BUY' : 'SELL';
          ruleSignal.raw_confidence = swingResult.confidence || ruleSignal.raw_confidence;

          // Confluence floor 50 → correction_risk ≤ 50 → risk penalty ≤ 20
          const adjustedRuleSignal = {
            ...ruleSignal,
            confluence_score: Math.max(ruleSignal.confluence_score, 50),
          };

          const evaluatedSignal = await evaluateSignalWithAI(rawInput, adjustedRuleSignal, undefined, ENGINE_TYPE);
          (evaluatedSignal as any).engine_type = ENGINE_TYPE;
          (evaluatedSignal as any).engine_version = ENGINE_VERSION;

          const signalRecord = signalToRow(evaluatedSignal, false, {
            trade_gate_allowed: true,
            trade_gate_reason: tradeGate.reason,
            trade_gate_et_time: tradeGate.currentTimeET,
            blocked_until_et: null,
            engine_version: ENGINE_VERSION,
          });
          signalRecord.engine_version = ENGINE_VERSION;

          const { data, error } = await supabase
            .from('ai_signals')
            .insert(signalRecord)
            .select()
            .single();

          if (error) {
            console.error(`[swing_fav8_shadow] DB error for ${symbol}/${timeframe}:`, error);
            return { type: 'error', symbol, timeframe, error_message: error.message };
          }

          generatedCount++;
          return {
            type: 'generated',
            symbol,
            timeframe,
            signal_type: evaluatedSignal.signal_type,
            confidence_score: evaluatedSignal.confidence_final,
            confluence_score: adjustedRuleSignal.confluence_score,
            signal_id: (data as any)?.id,
          } as SymbolResult;

        } catch (symbolError) {
          const errorMsg = symbolError instanceof Error ? symbolError.message : String(symbolError);
          const isTransient = isTransientError(symbolError);
          console.error(`[swing_fav8_shadow] ${isTransient ? '[TRANSIENT]' : '[PERMANENT]'} Error ${symbol}/${timeframe}: ${errorMsg}`);
          return { type: 'error', symbol, timeframe, error_message: `${isTransient ? '[Transient] ' : ''}${errorMsg}` } as SymbolResult;
        }
      })
    );

    const allResults = await Promise.all(allPromises);

    for (const result of allResults as SymbolResult[]) {
      if (!result) continue;
      if (result.type === 'generated') continue;
      if (result.type === 'deduped') dedupedCount++;
      else if (result.type === 'no_trade') noTradeCount++;
      else if (result.type === 'error') errorCount++;
    }

    const summary: HourlySummary = {
      engine_version: ENGINE_VERSION,
      run_started_at: runStartedAt,
      run_duration_ms: Date.now() - runStartTime,
      total_symbols: symbolsArray.length * TIMEFRAMES.length,
      generated_count: generatedCount,
      deduped_count: dedupedCount,
      no_trade_count: noTradeCount,
      error_count: errorCount,
    };

    console.log('[swing_fav8_shadow] Summary:', summary);

    return new Response(
      JSON.stringify({ status: 'completed', ...summary }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[swing_fav8_shadow] Fatal error:', error);
    return new Response(
      JSON.stringify({ status: 'error', error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function checkRecentSignal(
  supabase: ReturnType<typeof createClient>,
  symbol: string,
  timeframe: string,
  engineType: string
): Promise<{ minutes_ago: number } | null> {
  const { data, error } = await supabase
    .from('ai_signals')
    .select('updated_at')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('engine_type', engineType)
    .eq('is_manual_request', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const updatedAt = new Date(data.updated_at);
  const minutesAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60);
  if (minutesAgo < CACHE_WINDOW_MINUTES) return { minutes_ago: minutesAgo };
  return null;
}
