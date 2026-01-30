/**
 * Request TradeSignal Edge Function
 * 
 * Generates AI-powered trading signals by combining:
 * - Smart Money Concepts (SMC) - Order Blocks, BOS, Structure
 * - Volume Analysis - Relative volume, order flow
 * - Market Sentiment - News headlines, social signals
 * - Technical Indicators - Support/Resistance, Volatility
 * - Fundamentals - Key metrics (optional)
 * 
 * Implements global caching with TTL rules:
 * - < 1 hour: return cached immediately
 * - 1-24 hours: return cached (manual refresh for PRO)
 * - > 24 hours: return cached + trigger background refresh
 * - User manual: 10-min deduplication
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { assembleRawSignalInput } from '../_shared/signal_data_fetcher.ts';
import { computeRuleSignal } from '../_shared/signal_scorer.ts';
import { evaluateSignalWithAI } from '../_shared/signal_ai_evaluator.ts';
import { signalToRow, tradingStyleFromEngine, type EngineType } from '../_shared/signal_types.ts';
import { sendDiscordSignalNotification } from '../_shared/discord_signals_notifier.ts';
import { getSubscriptionStatusFromRequest, hasProAccess, createLockedResponse, checkDailyUsage } from '../_shared/subscription_checker.ts';
import { isIpBanned, logRateLimitViolation } from '../shared/rate_limit.ts';
import { ErrorCode, createError, errorResponse } from '../_shared/error_codes.ts';
import { getEngineForSymbol } from '../_shared/engine_router.ts';
import { getTradeGateStatus } from '../_shared/trade_gate.ts';
import { getWhitelistedTickers } from '../_shared/whitelist.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TradeSignalRequest {
  symbol: string;
  timeframe: string; // engine-specific timeframes
  engine_type: EngineType; // 'DAYTRADER' | 'SWING' | 'INVESTOR'
  user_id?: string;
  force_refresh?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { symbol, timeframe = '1H', engine_type, user_id, force_refresh = false }: TradeSignalRequest = await req.json();

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: 'missing_symbol', message: 'Symbol is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate engine_type (default to SWING for backward compatibility)
    const validEngines: EngineType[] = ['DAYTRADER', 'SWING', 'INVESTOR'];
    const finalEngineType = engine_type || 'SWING';
    
    if (!validEngines.includes(finalEngineType)) {
      return new Response(
        JSON.stringify({ error: 'invalid_engine_type', message: "engine_type must be one of 'DAYTRADER','SWING','INVESTOR'" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate timeframe within engine
    const tf = timeframe;
    const engineTimeframes: Record<EngineType, string[]> = {
      DAYTRADER: ['5m', '15m', '1H'],
      SWING: ['1H', '4H', '1D'],
      INVESTOR: ['1D', '1W', '1M'],
    };

    if (!engineTimeframes[finalEngineType].includes(tf)) {
      return new Response(
        JSON.stringify({
          error: 'invalid_timeframe_for_engine',
          message: `Timeframe ${tf} is not supported for engine ${engine_type}.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Derive trading_style from engine_type
    const finalTradingStyle = tradingStyleFromEngine(finalEngineType);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // SAFETY CHECK 1: Check if IP is banned (FEATURE_IP_BANS)
    const isBanned = await isIpBanned(supabase, req);
    if (isBanned) {
      return errorResponse(
        createError(ErrorCode.IP_BANNED),
        403
      );
    }

    // SAFETY CHECK 2: Get user from auth
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return errorResponse(
        createError(ErrorCode.UNAUTHORIZED),
        401
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return errorResponse(
        createError(ErrorCode.UNAUTHORIZED),
        401
      );
    }

    // SAFETY CHECK 3: Check subscription status
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const subscriptionStatus = await getSubscriptionStatusFromRequest(req, supabaseUrl, supabaseKey);
    
    if (!subscriptionStatus || !hasProAccess(subscriptionStatus)) {
      return new Response(
        JSON.stringify(createLockedResponse('TradeSignals', subscriptionStatus || {
          tier: 'expired',
          isPro: false,
          isTrial: false,
          isExpired: true
        })),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SAFETY CHECK 4: Check daily usage limits (FEATURE_FREE_TIER_LIMITS)
    const usageCheck = await checkDailyUsage(user.id, supabase, 'signal');
    
    if (!usageCheck.allowed) {
      // Log violation (FEATURE_RATE_LIMITING)
      await logRateLimitViolation(supabase, req, user.id, 'user_daily_cap');
      
      return errorResponse(
        createError(ErrorCode.FREE_LIMIT_EXCEEDED, {
          remaining: usageCheck.remaining,
          limit: usageCheck.limit,
          used: usageCheck.used,
          reset_at: 'midnight UTC'
        }),
        429
      );
    }
    const tradeGate = getTradeGateStatus(new Date());
    if (!tradeGate.allowed) {
      return new Response(
        JSON.stringify({
          error: 'TRADE_GATE_CLOSED',
          message: 'Signals are analysis-only until 10:00 ET.',
          reason: tradeGate.reason,
          currentTimeET: tradeGate.currentTimeET,
          gateStartET: tradeGate.gateStartET,
          gateEndET: tradeGate.gateEndET,
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const now = new Date();
    const symbolUpper = symbol.toUpperCase();

    const whitelist = await getWhitelistedTickers(supabase);
    const isWhitelisted = whitelist.some((row) => row.symbol === symbolUpper);

    if (!isWhitelisted) {
      console.warn(`[whitelist] rejected symbol=${symbolUpper}`);
      return new Response(
        JSON.stringify({
          error: 'UNAPPROVED_TICKER',
          message: 'This ticker is not approved for AI trading signals.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SAFETY CHECK 5: Ticker approval already validated by API route
    // The /api/tradesignal/request route checks approved_tickers_view before calling this function
    // This redundant check is commented out to avoid duplicate database queries and potential errors
    // Uncomment this block if you need defense-in-depth validation at Edge Function level
    /*
    const { data: approvedTickers, error: approvedError } = await supabase
      .from('approved_tickers_view')
      .select('ticker');
    
    if (approvedError || !approvedTickers || approvedTickers.length === 0) {
      console.error('[approved_tickers] Failed:', approvedError);
      return new Response(
        JSON.stringify({
          error: 'UNAPPROVED_TICKER',
          message: 'This ticker is not approved for AI trading signals.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const approvedList = approvedTickers.map(t => (t.ticker || '').toUpperCase()).filter(Boolean);
    if (!approvedList.includes(symbolUpper)) {
      return new Response(
        JSON.stringify({
          error: 'UNAPPROVED_TICKER',
          message: 'This ticker is not approved for AI trading signals.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    */

    // ENGINE ROUTING: Check if ticker is supported + get engine version
    const engineVersion = await getEngineForSymbol(symbolUpper, finalEngineType, timeframe);
    
    if (!engineVersion) {
      // Ticker not supported for this engine type
      const engineLabel = engine_type === 'DAYTRADER' ? 'Daytrader' : engine_type === 'SWING' ? 'Swing' : 'Investor';
      return new Response(
        JSON.stringify({
          error: 'ticker_not_supported',
          message: `This ticker is not supported for ${engineLabel} signals. It may have been disabled due to poor historical performance or not yet added to our approved ticker list.`,
          engine_type,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`[engine_router] ${symbolUpper} (${engine_type}) → ${engineVersion}`);

    // GLOBAL CACHE CHECK: Return cached signal if < 1 hour old
    if (!force_refresh) {
      const { data: cached, error: cacheError } = await supabase
        .from('ai_signals')
        .select('*')
        .eq('symbol', symbolUpper)
        .eq('timeframe', timeframe)
        .eq('engine_type', engine_type)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached && !cacheError) {
        const ageMinutes = (now.getTime() - new Date(cached.updated_at).getTime()) / (1000 * 60);

        // Only cache if < 1 hour
        if (ageMinutes < 60) {
          console.log(`[Cache HIT] ${symbolUpper}/${timeframe} - ${ageMinutes.toFixed(1)}min old`);
          return new Response(
            JSON.stringify({
              ...cached,
              is_cached: true,
              cache_age_minutes: Math.floor(ageMinutes),
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // If >= 1 hour, generate fresh signal
        console.log(`[Cache MISS] ${symbolUpper}/${timeframe} - ${ageMinutes.toFixed(1)}min old (stale)`);
      }
    }

    // Generate fresh signal using real data pipeline
    console.log(`Generating fresh TradeSignal for ${symbolUpper}/${timeframe}`);

    let rawInput, ruleSignal, evaluatedSignal;
    
    try {
      // 1. Fetch all market data (OHLCV, fundamentals, news, SMC)
      console.log('[Step 1] Fetching market data...');
      rawInput = await assembleRawSignalInput(symbolUpper, timeframe, finalEngineType);
      console.log('[Step 1] Market data fetched successfully');
    } catch (error) {
      console.error('[Step 1] Failed to fetch market data:', error);
      throw new Error(`Data fetch failed: ${error.message}`);
    }

    try {
      // 2. Compute rule-based signal with engine-specific logic
      console.log(`[Step 2] Computing rule-based signal with ${engine_type} engine...`);
      ruleSignal = computeRuleSignal(rawInput, finalEngineType);
      console.log(`[Step 2] Rule signal computed: ${ruleSignal.raw_signal_type} @ ${ruleSignal.raw_confidence}% (risk: ${ruleSignal.correction_risk}%)`);
      
      // Check engine-specific risk rejection
      if (ruleSignal.risk_should_reject) {
        throw new Error(`Signal rejected by ${engine_type} risk filter: risk ${ruleSignal.correction_risk}% exceeds engine tolerance`);
      }
    } catch (error) {
      console.error('[Step 2] Failed to compute rule signal:', error);
      throw new Error(`Rule computation failed: ${error.message}`);
    }

    try {
      // 3. Evaluate with AI using engine-specific personality
      console.log(`[Step 3] Evaluating with AI using ${engine_type} engine personality...`);
      evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal, undefined, finalEngineType);
      console.log(`[Step 3] AI evaluation complete: ${evaluatedSignal.ai_decision} @ ${evaluatedSignal.confidence_score}%`);
    } catch (error) {
      console.error('[Step 3] Failed AI evaluation:', error);
      throw new Error(`AI evaluation failed: ${error.message}`);
    }
    
    // Add trading style + engine to evaluated signal
    evaluatedSignal.trading_style = finalTradingStyle;
    evaluatedSignal.engine_type = engine_type;
    if (engineVersion) {
      (evaluatedSignal as any).engine_version = engineVersion;
    }

    // 4. Convert to database row format
    const signalRecord = signalToRow(evaluatedSignal, true, {
      trade_gate_allowed: true,
      trade_gate_reason: tradeGate.reason,
      trade_gate_et_time: tradeGate.currentTimeET,
      blocked_until_et: null,
    });
    if (engineVersion) {
      signalRecord.engine_version = engineVersion;
    }

    // 5. Store in database
    const { data: inserted, error: insertError } = await supabase
      .from('ai_signals')
      .insert(signalRecord)
      .select()
      .single();

    if (insertError) {
      console.error('[INSERT ERROR] Failed to store signal in database');
      console.error('[INSERT ERROR] Error details:', JSON.stringify(insertError, null, 2));
      console.error('[INSERT ERROR] Signal record being inserted:', JSON.stringify(signalRecord, null, 2));
      // Return signal anyway even if storage fails
      return new Response(
        JSON.stringify({
          id: 'temp_' + Date.now(),
          symbol: symbolUpper,
          timeframe,
          signal_type: evaluatedSignal.signal_type,
          ai_decision: evaluatedSignal.ai_decision,
          confidence_score: evaluatedSignal.confidence_score,
          entry_price: evaluatedSignal.entry_price,
          stop_loss: evaluatedSignal.stop_loss,
          take_profit_1: evaluatedSignal.take_profit_1,
          take_profit_2: evaluatedSignal.take_profit_2,
          reasoning: evaluatedSignal.reasoning,
          risk_factors: evaluatedSignal.risk_factors,
          status: 'completed',
          created_at: now.toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Send Discord notification for new manual signal (non-blocking)
    try {
      await sendDiscordSignalNotification(inserted, 'manual');
    } catch (discordError) {
      console.warn('[Discord] Failed to send notification (non-fatal):', discordError);
    }

    // 7. Return response with fresh signal indicator
    return new Response(
      JSON.stringify({
        id: inserted.id,
        symbol: inserted.symbol,
        timeframe: inserted.timeframe,
        trading_style: inserted.trading_style,
        engine_type: inserted.engine_type,
        engine_version: inserted.engine_version || null,
        signal_type: inserted.signal_type,
        ai_decision: inserted.ai_decision,
        confidence_score: inserted.confidence_score,
        smc_confidence: inserted.smc_confidence,
        volume_confidence: inserted.volume_confidence,
        sentiment_confidence: inserted.sentiment_confidence,
        confluence_score: inserted.confluence_score,
        entry_price: inserted.entry_price,
        stop_loss: inserted.stop_loss,
        take_profit_1: inserted.take_profit_1,
        take_profit_2: inserted.take_profit_2,
        reasoning: inserted.reasoning,
        reasons: inserted.reasons,
        risk_factors: inserted.risk_factors,
        correction_risk: inserted.correction_risk,
        smc_data: inserted.smc_data,
        volume_data: inserted.volume_data,
        sentiment_data: inserted.sentiment_data,
        is_cached: false,
        cache_age_minutes: 0,
        is_manual_request: true,
        created_at: inserted.created_at,
        updated_at: inserted.updated_at,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('TradeSignal generation error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    
    return new Response(
      JSON.stringify({
        error: 'generation_failed',
        message: error.message || 'Failed to generate TradeSignal',
        details: error.stack || error.toString(),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
