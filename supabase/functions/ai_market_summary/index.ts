/**
 * AI Market Summary Edge Function
 * 
 * GET /ai_market_summary
 * 
 * Returns daily AI-generated market summary with sentiment and key points.
 * PRO feature with trial access, controlled by subscription + devForcePro.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { getUserSubscriptionStatus, hasProAccess, createLockedResponse } from '../_shared/subscription_checker.ts';
import { fetchBulkQuotes } from '../_shared/yahoo_v8_client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MarketMetrics {
  spy_change: number;
  vix_level: number;
  breadth: string;
}

interface MarketSummaryResponse {
  summary: string;
  sentiment: 'bullish' | 'neutral' | 'bearish';
  key_points: string[];
  as_of_date: string;
  updated_at: string;
  cached: boolean;
  isLive: boolean;
  metrics?: MarketMetrics; // Only for PRO users
  access?: {
    is_locked: boolean;
    locked_sections?: string[];
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract user from JWT
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      
      if (!userError && user) {
        userId = user.id;
      }
    }

    // Check subscription status
    if (!userId) {
      return new Response(
        JSON.stringify({
          locked: true,
          message: 'Authentication required',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subscriptionStatus = await getUserSubscriptionStatus(userId, supabaseUrl, supabaseKey);
    const hasPro = hasProAccess(subscriptionStatus);

    // Check cache first (1 hour TTL)
    const cacheKey = 'ai_market_summary';
    const { data: cached } = await supabase
      .from('ai_cache')
      .select('cached_data, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 60 * 60 * 1000) { // 1 hour
        console.log(`[MarketSummary] Cache HIT`);
        return new Response(
          JSON.stringify({ ...cached.cached_data, cached: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[MarketSummary] Cache MISS, fetching live data...`);

    const today = new Date().toISOString().split('T')[0];
    let isLive = false;
    let metrics: MarketMetrics | undefined;
    let sentiment: 'bullish' | 'neutral' | 'bearish';
    let summary: string;
    let keyPoints: string[];

    try {
      // Fetch live market data from Yahoo Finance v8
      const symbols = ['SPY', '^VIX', 'XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLI'];
      const quotes = await fetchBulkQuotes(symbols);
      
      const spy = quotes['SPY'];
      const vix = quotes['^VIX'];
      
      if (spy && vix) {
        isLive = true;
        
        // Calculate breadth from sector ETFs
        const sectorSymbols = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLI'];
        const positiveSectors = sectorSymbols.filter(s => quotes[s]?.changePercent && quotes[s].changePercent > 0).length;
        const breadthPct = (positiveSectors / sectorSymbols.length) * 100;
        const breadth = breadthPct >= 66 ? 'bullish' : breadthPct <= 33 ? 'bearish' : 'neutral';
        
        metrics = {
          spy_change: spy.changePercent || 0,
          vix_level: vix.price || 15,
          breadth: `${Math.round(breadthPct)}% sectors positive`,
        };
        
        // Determine sentiment from live data
        sentiment = determineSentimentFromData(spy.changePercent || 0, vix.price || 15, breadth);
        summary = generateSummary(sentiment);
        keyPoints = generateKeyPoints(sentiment, metrics);
        
        console.log(`[MarketSummary] Live data: SPY ${spy.changePercent?.toFixed(2)}%, VIX ${vix.price?.toFixed(2)}`);
      } else {
        throw new Error('Invalid market data from Yahoo Finance');
      }
    } catch (error) {
      console.error('[MarketSummary] Failed to fetch live data, using mock:', error.message);
      isLive = false;
      sentiment = determineSentiment();
      summary = generateSummary(sentiment);
      keyPoints = generateKeyPoints(sentiment);
    }

    // Build response with PRO gating
    const response: MarketSummaryResponse = {
      summary,
      sentiment,
      key_points: hasPro ? keyPoints : [keyPoints[0]], // Free: first bullet only
      as_of_date: today,
      updated_at: new Date().toISOString(),
      cached: false,
      isLive,
      metrics: hasPro ? metrics : undefined, // Free: no metrics
      access: {
        is_locked: !hasPro,
        locked_sections: hasPro ? undefined : ['metrics', 'advancedBullets'],
      },
    };

    // Save to cache
    await supabase.from('ai_cache').upsert({
      cache_key: cacheKey,
      cached_data: response,
      created_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('AI Market Summary error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Determine sentiment from live market data
 */
function determineSentimentFromData(
  spyChange: number,
  vixLevel: number,
  breadth: 'bullish' | 'neutral' | 'bearish'
): 'bullish' | 'neutral' | 'bearish' {
  // Bullish: SPY up, VIX low, breadth positive
  if (spyChange > 0.5 && vixLevel < 17 && breadth === 'bullish') {
    return 'bullish';
  }
  
  // Bearish: SPY down, VIX elevated, breadth negative
  if (spyChange < -0.5 || vixLevel > 22 || breadth === 'bearish') {
    return 'bearish';
  }
  
  // Neutral: mixed signals
  return 'neutral';
}

/**
 * Fallback sentiment for mock data
 */
function determineSentiment(): 'bullish' | 'neutral' | 'bearish' {
  const hour = new Date().getHours();
  if (hour < 8) return 'bullish';
  if (hour < 16) return 'neutral';
  return 'bearish';
}

/**
 * Generate AI summary text based on sentiment
 */
function generateSummary(sentiment: 'bullish' | 'neutral' | 'bearish'): string {
  const summaries = {
    bullish: "Markets are showing constructive price action with healthy rotation into growth sectors. Key support levels are holding, and institutional accumulation is evident across major indices. The current environment favors selective long positions in high-quality setups.",
    neutral: "Markets are consolidating in a narrow range as participants digest recent moves. Mixed signals across sectors suggest a wait-and-see approach. Focus on high-probability setups with clear risk/reward ratios while remaining nimble.",
    bearish: "Market structure is showing signs of distribution with key support levels under pressure. Defensive rotation and elevated volatility suggest increased caution. Prioritize capital preservation and wait for confirmation of trend reversal before deploying new positions.",
  };
  
  return summaries[sentiment];
}

/**
 * Generate key points based on sentiment and live metrics
 */
function generateKeyPoints(
  sentiment: 'bullish' | 'neutral' | 'bearish',
  metrics?: MarketMetrics
): string[] {
  if (!metrics) {
    // Mock key points
    const points = {
      bullish: [
        "Major indices holding above key moving averages",
        "Technology and growth sectors showing relative strength",
        "Volume patterns confirm institutional accumulation",
      ],
      neutral: [
        "Sideways consolidation forming on daily timeframes",
        "Sector rotation providing selective opportunities",
        "Await breakout above resistance or breakdown below support",
      ],
      bearish: [
        "Key support levels violated on multiple timeframes",
        "Defensive rotation and elevated volatility suggest caution",
        "Rising volatility (VIX) signaling increased uncertainty",
      ],
    };
    return points[sentiment];
  }
  
  // Live data key points
  const spyDirection = metrics.spy_change > 0 ? 'gained' : 'declined';
  const spyMagnitude = Math.abs(metrics.spy_change) > 1 ? 'significantly' : 'modestly';
  const vixStatus = metrics.vix_level < 15 ? 'low' : metrics.vix_level > 20 ? 'elevated' : 'moderate';
  
  const points = {
    bullish: [
      `S&P 500 ${spyMagnitude} ${spyDirection} ${Math.abs(metrics.spy_change).toFixed(2)}%, confirming positive momentum`,
      `VIX at ${metrics.vix_level.toFixed(1)} indicates ${vixStatus} fear levels`,
      `Broad market participation: ${metrics.breadth}`,
    ],
    neutral: [
      `S&P 500 ${spyMagnitude} ${spyDirection} ${Math.abs(metrics.spy_change).toFixed(2)}%, showing consolidation`,
      `VIX at ${metrics.vix_level.toFixed(1)} suggests ${vixStatus} uncertainty`,
      `Mixed sector performance: ${metrics.breadth}`,
    ],
    bearish: [
      `S&P 500 ${spyMagnitude} ${spyDirection} ${Math.abs(metrics.spy_change).toFixed(2)}%, signaling weakness`,
      `VIX spike to ${metrics.vix_level.toFixed(1)} indicates ${vixStatus} risk aversion`,
      `Weak market breadth: ${metrics.breadth}`,
    ],
  };
  
  return points[sentiment];
}
