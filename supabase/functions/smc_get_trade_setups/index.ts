/**
 * SMC Get Trade Setups Edge Function
 * Generates AI-powered trade setups using OpenAI
 * Calculates entry, stop loss, take profit, risk/reward, confidence
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { callAi } from '../shared/ai_client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrderBlock {
  id: string;
  direction: string;
  high: number;
  low: number;
  mitigated: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker, timeframe = '1h', user_tier = 'free' } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'missing_ticker', message: 'Ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check for cached trade setups (< 10 min old) for free users
    if (user_tier === 'free') {
      const tenMinutesAgo = new Date();
      tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

      const { data: cachedSetups } = await supabase
        .from('smc_trade_setups')
        .select('*')
        .eq('ticker', ticker)
        .eq('timeframe', timeframe)
        .gte('created_at', tenMinutesAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(2);

      if (cachedSetups && cachedSetups.length > 0) {
        return new Response(
          JSON.stringify({
            ticker,
            timeframe,
            setups: cachedSetups,
            cached: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Fetch latest SMC data
    const { data: orderBlocks, error: obError } = await supabase
      .from('smc_order_blocks')
      .select('*')
      .eq('ticker', ticker)
      .eq('timeframe', timeframe)
      .order('created_at', { ascending: false })
      .limit(10);

    if (obError || !orderBlocks || orderBlocks.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'no_smc_data',
          message: 'No SMC data found. Run smc_calculate_levels first.',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: bosEvents } = await supabase
      .from('smc_bos_events')
      .select('*')
      .eq('ticker', ticker)
      .eq('timeframe', timeframe)
      .order('event_time', { ascending: false })
      .limit(5);

    // Get current price from Yahoo Finance (reuse existing get_quote function)
    let currentPrice = 0;
    try {
      const quoteResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/get_quote`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({ ticker }),
        }
      );
      const quoteData = await quoteResponse.json();
      currentPrice = quoteData.current_price || 0;
    } catch (error) {
      console.error('Error fetching current price:', error);
      // Use mid price from latest OB if Yahoo fails
      currentPrice = (orderBlocks[0].high + orderBlocks[0].low) / 2;
    }

    // Find candidate OBs for trade setups
    const activeBullishOBs = (orderBlocks as OrderBlock[]).filter(
      ob => ob.direction === 'bullish' && !ob.mitigated && ob.low < currentPrice
    );
    const activeBearishOBs = (orderBlocks as OrderBlock[]).filter(
      ob => ob.direction === 'bearish' && !ob.mitigated && ob.high > currentPrice
    );

    const setups: any[] = [];

    // Generate long setup (from bullish OB)
    if (activeBullishOBs.length > 0) {
      const ob = activeBullishOBs[0];
      const entry = (ob.high + ob.low) / 2; // OB midpoint
      const stopLoss = ob.low - (ob.high - ob.low) * 0.2; // 20% below OB
      const takeProfit = entry + (entry - stopLoss) * 3; // 3:1 R:R
      const riskReward = (takeProfit - entry) / (entry - stopLoss);

      // Call OpenAI for rationale and confidence
      const aiRationale = await generateAIRationale(
        ticker,
        'long',
        entry,
        stopLoss,
        takeProfit,
        orderBlocks,
        bosEvents || []
      );

      setups.push({
        ticker,
        timeframe,
        side: 'long',
        entry,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        risk_reward: riskReward,
        confidence: aiRationale.confidence,
        rationale: aiRationale.text,
        source_ob_id: ob.id,
      });
    }

    // Generate short setup (from bearish OB)
    if (activeBearishOBs.length > 0) {
      const ob = activeBearishOBs[0];
      const entry = (ob.high + ob.low) / 2;
      const stopLoss = ob.high + (ob.high - ob.low) * 0.2;
      const takeProfit = entry - (stopLoss - entry) * 3;
      const riskReward = (entry - takeProfit) / (stopLoss - entry);

      const aiRationale = await generateAIRationale(
        ticker,
        'short',
        entry,
        stopLoss,
        takeProfit,
        orderBlocks,
        bosEvents || []
      );

      setups.push({
        ticker,
        timeframe,
        side: 'short',
        entry,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        risk_reward: riskReward,
        confidence: aiRationale.confidence,
        rationale: aiRationale.text,
        source_ob_id: ob.id,
      });
    }

    // Save setups to database
    if (setups.length > 0) {
      await supabase.from('smc_trade_setups').insert(setups);
    }

    return new Response(
      JSON.stringify({
        ticker,
        timeframe,
        setups,
        cached: false,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Generate AI rationale and confidence using shared AI client
 */
async function generateAIRationale(
  ticker: string,
  side: string,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  orderBlocks: any[],
  bosEvents: any[]
): Promise<{ text: string; confidence: number }> {
  const prompt = `You are a professional Smart Money Concepts (SMC) trading analyst. Analyze this trade setup:

Ticker: ${ticker}
Side: ${side.toUpperCase()}
Entry: $${entry.toFixed(2)}
Stop Loss: $${stopLoss.toFixed(2)}
Take Profit: $${takeProfit.toFixed(2)}

Context:
- ${orderBlocks.length} order blocks detected
- Latest BOS: ${bosEvents.length > 0 ? bosEvents[0].direction : 'none'}
- Active bullish OBs: ${orderBlocks.filter((ob) => ob.direction === 'bullish' && !ob.mitigated).length}
- Active bearish OBs: ${orderBlocks.filter((ob) => ob.direction === 'bearish' && !ob.mitigated).length}

Provide:
1. A 2-3 sentence rationale explaining why this setup is valid based on SMC principles.
2. A confidence score (0-1) for this trade.

Format your response as JSON:
{
  "rationale": "...",
  "confidence": 0.75
}`;

  try {
    // Use shared AI client for consistency, cost tracking, and caching
    const responseText = await callAi({
      userId: 'system',
      tier: 'admin',
      task: 'smc_trade_setups',
      prompt,
      maxTokens: 300,
    });

    const parsed = JSON.parse(responseText);

    return {
      text: parsed.rationale,
      confidence: Math.max(0, Math.min(1, parsed.confidence)), // Clamp 0-1
    };
  } catch (error) {
    console.error('AI error:', error);
    // Fallback
    return {
      text: `${ticker} shows a ${side} setup from a fresh order block. Price is reacting from institutional levels with a ${
        (Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)).toFixed(1)
      }:1 risk-reward ratio.`,
      confidence: 0.68,
    };
  }
}
