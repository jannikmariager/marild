/**
 * AI Highlights Today Edge Function
 * 
 * Returns today's key AI-generated trading highlights:
 * - Strongest BUY signal
 * - Strongest SELL signal
 * - Strongest/Weakest sectors
 * - AI market sentiment
 * - Top SMC zone
 * 
 * Implements 10-15 minute caching and PRO gating.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { getSubscriptionStatusFromRequest, hasProAccess, createLockedResponse } from '../_shared/subscription_checker.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_KEY = 'ai_highlights_today';
const CACHE_TTL_MINUTES = 15;

interface AIHighlight {
  symbol: string;
  confidence: number;
  confluence_score: number;
  timeframe: string;
  signal_type: string;
}

interface AIHighlightsResponse {
  // Trading day this snapshot represents (YYYY-MM-DD)
  date: string;
  // Exact timestamp when this highlight snapshot was computed
  updated_at: string;
  strongest_buy: AIHighlight | null;
  strongest_sell: AIHighlight | null;
  strongest_sector: string | null;
  weakest_sector: string | null;
  ai_sentiment: 'bullish' | 'neutral' | 'bearish';
  top_smc_zone: {
    symbol: string;
    level_price: number;
  } | null;
  cached: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check PRO access
    const subscriptionStatus = await getSubscriptionStatusFromRequest(
      req,
      supabaseUrl,
      supabaseKey
    );
    
    if (!subscriptionStatus || !hasProAccess(subscriptionStatus)) {
      // Return locked response with mock data showing what's available
      return new Response(
        JSON.stringify({
          error: 'subscription_required',
          message: 'This feature requires an active PRO subscription or trial',
          tier: subscriptionStatus?.tier || 'free',
          has_access: false,
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check cache first
    const cacheThreshold = new Date(Date.now() - CACHE_TTL_MINUTES * 60 * 1000);
    const { data: cachedData, error: cacheError } = await supabase
      .from('ai_cache')
      .select('value, updated_at')
      .eq('key', CACHE_KEY)
      .gte('updated_at', cacheThreshold.toISOString())
      .maybeSingle();

    if (!cacheError && cachedData) {
      console.log('[ai_highlights_today] Cache hit');
      return new Response(
        JSON.stringify({
          ...cachedData.value,
          cached: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('[ai_highlights_today] Cache miss, computing fresh highlights');

    // Fetch today's signals (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: signals, error: signalsError } = await supabase
      .from('ai_signals')
      .select('symbol, signal_type, confidence_score, confluence_score, timeframe, created_at')
      .gte('created_at', oneDayAgo.toISOString())
      // Focus highlights on intraday context: 1H timeframe signals
      .eq('timeframe', '1H')
      .order('confidence_score', { ascending: false })
      .limit(100);

    if (signalsError) {
      console.error('[ai_highlights_today] Error fetching signals:', signalsError);
      throw new Error('Failed to fetch signals');
    }

    // Find strongest BUY and SELL
    const buySignals = signals
      ?.filter(s => s.signal_type === 'buy' || s.signal_type === 'long')
      .sort((a, b) => (b.confluence_score || 0) - (a.confluence_score || 0)) || [];
    
    const sellSignals = signals
      ?.filter(s => s.signal_type === 'sell' || s.signal_type === 'short')
      .sort((a, b) => (b.confluence_score || 0) - (a.confluence_score || 0)) || [];

    const strongestBuy = buySignals[0] ? {
      symbol: buySignals[0].symbol,
      confidence: buySignals[0].confidence_score,
      confluence_score: buySignals[0].confluence_score || 0,
      timeframe: buySignals[0].timeframe,
      signal_type: buySignals[0].signal_type,
    } : null;

    const strongestSell = sellSignals[0] ? {
      symbol: sellSignals[0].symbol,
      confidence: sellSignals[0].confidence_score,
      confluence_score: sellSignals[0].confluence_score || 0,
      timeframe: sellSignals[0].timeframe,
      signal_type: sellSignals[0].signal_type,
    } : null;

    // Calculate sector performance (simplified)
    // Group signals by sector if available, or use mock sectors
    const sectorMap: Record<string, { buy: number; sell: number }> = {
      'Technology': { buy: 0, sell: 0 },
      'Financials': { buy: 0, sell: 0 },
      'Healthcare': { buy: 0, sell: 0 },
      'Energy': { buy: 0, sell: 0 },
      'Consumer': { buy: 0, sell: 0 },
    };

    // Simple sector inference from symbols (mock logic)
    signals?.forEach(signal => {
      const symbol = signal.symbol.toUpperCase();
      let sector = 'Consumer';
      
      if (['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA', 'META', 'AMZN'].includes(symbol)) {
        sector = 'Technology';
      } else if (['JPM', 'BAC', 'GS', 'WFC', 'C'].includes(symbol)) {
        sector = 'Financials';
      } else if (['JNJ', 'UNH', 'PFE', 'ABBV', 'TMO'].includes(symbol)) {
        sector = 'Healthcare';
      } else if (['XOM', 'CVX', 'COP', 'SLB', 'OXY'].includes(symbol)) {
        sector = 'Energy';
      }

      if (sectorMap[sector]) {
        if (signal.signal_type === 'buy' || signal.signal_type === 'long') {
          sectorMap[sector].buy++;
        } else {
          sectorMap[sector].sell++;
        }
      }
    });

    // Calculate net sentiment per sector
    const sectorScores = Object.entries(sectorMap).map(([sector, counts]) => ({
      sector,
      score: counts.buy - counts.sell,
    })).sort((a, b) => b.score - a.score);

    const strongestSector = sectorScores[0]?.sector || null;
    const weakestSector = sectorScores[sectorScores.length - 1]?.sector || null;

    // Calculate AI sentiment from correction risk or signal distribution
    const { data: correctionRisk } = await supabase
      .from('correction_risk_snapshots')
      .select('risk_score, risk_label')
      .order('as_of_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    let aiSentiment: 'bullish' | 'neutral' | 'bearish' = 'neutral';
    
    if (correctionRisk) {
      if (correctionRisk.risk_score < 40) {
        aiSentiment = 'bullish';
      } else if (correctionRisk.risk_score > 60) {
        aiSentiment = 'bearish';
      }
    } else {
      // Fallback: use signal distribution
      const bullishCount = buySignals.length;
      const bearishCount = sellSignals.length;
      
      if (bullishCount > bearishCount * 1.5) {
        aiSentiment = 'bullish';
      } else if (bearishCount > bullishCount * 1.5) {
        aiSentiment = 'bearish';
      }
    }

    // Fetch top SMC zone (highest confidence order block)
    const { data: smcLevels } = await supabase
      .from('smc_levels')
      .select('symbol, level_price, confidence')
      .eq('level_type', 'order_block')
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();

    const topSmcZone = smcLevels ? {
      symbol: smcLevels.symbol,
      level_price: smcLevels.level_price,
    } : null;

    // Construct response
    const nowIso = new Date().toISOString();
    const response: AIHighlightsResponse = {
      date: nowIso.split('T')[0],
      updated_at: nowIso,
      strongest_buy: strongestBuy,
      strongest_sell: strongestSell,
      strongest_sector: strongestSector,
      weakest_sector: weakestSector,
      ai_sentiment: aiSentiment,
      top_smc_zone: topSmcZone,
      cached: false,
    };

    // Store in cache
    await supabase
      .from('ai_cache')
      .upsert({
        key: CACHE_KEY,
        value: response,
        updated_at: new Date().toISOString(),
      });

    console.log('[ai_highlights_today] Fresh highlights computed and cached');

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[ai_highlights_today] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'internal_error',
        message: error.message || 'Failed to fetch AI highlights',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
