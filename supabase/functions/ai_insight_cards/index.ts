/**
 * AI Insight Cards Edge Function
 * 
 * GET /ai_insight_cards
 * 
 * Returns AI-generated actionable insight cards combining market data,
 * sentiment analysis, and technical context.
 * 
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

type InsightType = 
  | 'market_alert' 
  | 'sector_rotation' 
  | 'volatility_watch' 
  | 'momentum_shift'
  | 'risk_opportunity';

type SentimentType = 'bullish' | 'neutral' | 'bearish';

interface InsightMetric {
  label: string;
  value: string;
  change?: string;
  sentiment?: SentimentType;
}

interface InsightCard {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  sentiment: SentimentType;
  metrics: InsightMetric[];
  timestamp: string;
  isLocked?: boolean;
}

interface InsightCardsResponse {
  cards: InsightCard[];
  as_of_date: string;
  updated_at: string;
  cached: boolean;
  isLive: boolean;
  access: {
    is_locked: boolean;
    total_cards: number;
    unlocked_cards: number;
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

    // Check cache first (30 minute TTL)
    const cacheKey = 'ai_insight_cards';
    const { data: cached } = await supabase
      .from('ai_cache')
      .select('cached_data, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 30 * 60 * 1000) { // 30 minutes
        console.log(`[InsightCards] Cache HIT`);
        const cachedResponse = cached.cached_data as InsightCardsResponse;
        
        // Apply PRO gating to cached data
        const gatedResponse = applyProGating(cachedResponse, hasPro);
        
        return new Response(
          JSON.stringify({ ...gatedResponse, cached: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[InsightCards] Cache MISS, generating new insights...`);

    const today = new Date().toISOString().split('T')[0];
    let isLive = false;
    let cards: InsightCard[] = [];

    try {
      // Fetch live market data from Yahoo Finance v8
      const symbols = ['SPY', '^VIX', 'QQQ', '^DJI', '^GSPC', 'XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLI', 'XLU', 'XLRE', 'XLB'];
      const quotes = await fetchBulkQuotes(symbols);
      
      const spy = quotes['SPY'];
      const vix = quotes['^VIX'];
      const qqq = quotes['QQQ'];
      
      if (spy && vix && qqq) {
        isLive = true;
        cards = generateLiveInsightCards(quotes);
        console.log(`[InsightCards] Generated ${cards.length} live insight cards`);
      } else {
        throw new Error('Insufficient market data from Yahoo Finance');
      }
    } catch (error) {
      console.error('[InsightCards] Failed to fetch live data, using mock:', error.message);
      isLive = false;
      cards = generateMockInsightCards();
    }

    // Build response with PRO gating
    const response: InsightCardsResponse = {
      cards,
      as_of_date: today,
      updated_at: new Date().toISOString(),
      cached: false,
      isLive,
      access: {
        is_locked: !hasPro,
        total_cards: cards.length,
        unlocked_cards: hasPro ? cards.length : 1, // Free: only first card
      },
    };

    // Apply PRO gating before caching
    const gatedResponse = applyProGating(response, hasPro);

    // Save to cache (store ungated version)
    await supabase.from('ai_cache').upsert({
      cache_key: cacheKey,
      cached_data: response,
      created_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify(gatedResponse),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('AI Insight Cards error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Apply PRO gating to insight cards response
 */
function applyProGating(response: InsightCardsResponse, hasPro: boolean): InsightCardsResponse {
  if (hasPro) {
    return response;
  }

  // Free users: lock all cards except first one
  const gatedCards = response.cards.map((card, index) => {
    if (index === 0) {
      return card; // First card unlocked for preview
    }
    
    return {
      ...card,
      description: 'Upgrade to PRO to unlock this insight',
      metrics: [],
      isLocked: true,
    };
  });

  return {
    ...response,
    cards: gatedCards,
    access: {
      is_locked: true,
      total_cards: response.cards.length,
      unlocked_cards: 1,
    },
  };
}

/**
 * Generate live insight cards from market data
 */
function generateLiveInsightCards(quotes: Record<string, any>): InsightCard[] {
  const cards: InsightCard[] = [];
  const timestamp = new Date().toISOString();

  const spy = quotes['SPY'];
  const vix = quotes['^VIX'];
  const qqq = quotes['QQQ'];

  // 1. Market Alert Card
  const spyChange = spy?.changePercent || 0;
  const marketSentiment: SentimentType = spyChange > 0.5 ? 'bullish' : spyChange < -0.5 ? 'bearish' : 'neutral';
  
  cards.push({
    id: 'market-alert-1',
    type: 'market_alert',
    title: spyChange > 0 ? 'Market Advancing' : spyChange < 0 ? 'Market Declining' : 'Market Consolidating',
    description: getMarketAlertDescription(spyChange, vix?.price || 15),
    sentiment: marketSentiment,
    metrics: [
      {
        label: 'S&P 500',
        value: `${spy?.price?.toFixed(2) || '---'}`,
        change: `${spyChange > 0 ? '+' : ''}${spyChange.toFixed(2)}%`,
        sentiment: marketSentiment,
      },
      {
        label: 'VIX',
        value: `${vix?.price?.toFixed(2) || '---'}`,
        sentiment: (vix?.price || 15) < 15 ? 'bullish' : (vix?.price || 15) > 20 ? 'bearish' : 'neutral',
      },
    ],
    timestamp,
  });

  // 2. Sector Rotation Card
  const sectorSymbols = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLI'];
  const sectorPerformance = sectorSymbols
    .map(s => ({ symbol: s, change: quotes[s]?.changePercent || 0 }))
    .sort((a, b) => b.change - a.change);
  
  const topSector = sectorPerformance[0];
  const bottomSector = sectorPerformance[sectorPerformance.length - 1];

  cards.push({
    id: 'sector-rotation-1',
    type: 'sector_rotation',
    title: 'Active Sector Rotation',
    description: `${getSectorName(topSector.symbol)} leading with ${topSector.change > 0 ? 'gains' : 'losses'} while ${getSectorName(bottomSector.symbol)} ${bottomSector.change < 0 ? 'lags' : 'underperforms'}. Watch for continuation or reversal patterns.`,
    sentiment: topSector.change > 0.5 ? 'bullish' : topSector.change < -0.5 ? 'bearish' : 'neutral',
    metrics: [
      {
        label: 'Leader',
        value: getSectorName(topSector.symbol),
        change: `${topSector.change > 0 ? '+' : ''}${topSector.change.toFixed(2)}%`,
        sentiment: topSector.change > 0 ? 'bullish' : 'bearish',
      },
      {
        label: 'Laggard',
        value: getSectorName(bottomSector.symbol),
        change: `${bottomSector.change > 0 ? '+' : ''}${bottomSector.change.toFixed(2)}%`,
        sentiment: bottomSector.change > 0 ? 'bullish' : 'bearish',
      },
    ],
    timestamp,
  });

  // 3. Volatility Watch Card
  const vixLevel = vix?.price || 15;
  const vixSentiment: SentimentType = vixLevel < 15 ? 'bullish' : vixLevel > 20 ? 'bearish' : 'neutral';
  
  cards.push({
    id: 'volatility-watch-1',
    type: 'volatility_watch',
    title: vixLevel < 15 ? 'Low Volatility Environment' : vixLevel > 20 ? 'Elevated Volatility' : 'Moderate Volatility',
    description: getVolatilityDescription(vixLevel),
    sentiment: vixSentiment,
    metrics: [
      {
        label: 'VIX Level',
        value: `${vixLevel.toFixed(2)}`,
        sentiment: vixSentiment,
      },
      {
        label: 'Risk Mode',
        value: vixLevel < 15 ? 'Risk-On' : vixLevel > 20 ? 'Risk-Off' : 'Balanced',
        sentiment: vixSentiment,
      },
    ],
    timestamp,
  });

  // 4. Momentum Shift Card
  const qqqChange = qqq?.changePercent || 0;
  const momentumDivergence = Math.abs(qqqChange - spyChange);
  
  cards.push({
    id: 'momentum-shift-1',
    type: 'momentum_shift',
    title: momentumDivergence > 0.5 ? 'Growth vs Value Divergence' : 'Aligned Market Momentum',
    description: getMomentumDescription(qqqChange, spyChange, momentumDivergence),
    sentiment: qqqChange > spyChange ? 'bullish' : 'neutral',
    metrics: [
      {
        label: 'Nasdaq-100',
        value: `${qqq?.price?.toFixed(2) || '---'}`,
        change: `${qqqChange > 0 ? '+' : ''}${qqqChange.toFixed(2)}%`,
        sentiment: qqqChange > 0 ? 'bullish' : 'bearish',
      },
      {
        label: 'Divergence',
        value: `${momentumDivergence.toFixed(2)}%`,
        sentiment: momentumDivergence < 0.3 ? 'neutral' : 'bullish',
      },
    ],
    timestamp,
  });

  return cards;
}

/**
 * Generate mock insight cards for fallback
 */
function generateMockInsightCards(): InsightCard[] {
  const timestamp = new Date().toISOString();
  
  return [
    {
      id: 'mock-market-alert',
      type: 'market_alert',
      title: 'Market Consolidating',
      description: 'Major indices trading in narrow ranges as investors await key economic data releases. Current price action suggests indecision with balanced buying and selling pressure.',
      sentiment: 'neutral',
      metrics: [
        { label: 'S&P 500', value: '---', change: '---', sentiment: 'neutral' },
        { label: 'VIX', value: '---', sentiment: 'neutral' },
      ],
      timestamp,
    },
    {
      id: 'mock-sector-rotation',
      type: 'sector_rotation',
      title: 'Technology Leading Sectors',
      description: 'Technology sector showing relative strength while energy lags. Monitor for continuation or reversal signals.',
      sentiment: 'bullish',
      metrics: [
        { label: 'Leader', value: 'Technology', change: '---', sentiment: 'bullish' },
        { label: 'Laggard', value: 'Energy', change: '---', sentiment: 'bearish' },
      ],
      timestamp,
    },
    {
      id: 'mock-volatility',
      type: 'volatility_watch',
      title: 'Moderate Volatility Environment',
      description: 'VIX at average levels suggesting balanced risk-reward across the market.',
      sentiment: 'neutral',
      metrics: [
        { label: 'VIX Level', value: '---', sentiment: 'neutral' },
        { label: 'Risk Mode', value: 'Balanced', sentiment: 'neutral' },
      ],
      timestamp,
    },
    {
      id: 'mock-momentum',
      type: 'momentum_shift',
      title: 'Aligned Market Momentum',
      description: 'Growth and value sectors moving in sync, indicating broad market participation.',
      sentiment: 'neutral',
      metrics: [
        { label: 'Nasdaq-100', value: '---', change: '---', sentiment: 'neutral' },
        { label: 'Divergence', value: '---', sentiment: 'neutral' },
      ],
      timestamp,
    },
  ];
}

/**
 * Helper: Get market alert description
 */
function getMarketAlertDescription(spyChange: number, vixLevel: number): string {
  if (spyChange > 1.0 && vixLevel < 15) {
    return 'Strong bullish momentum with low volatility suggests healthy market conditions. Watch for potential overextension at resistance levels.';
  } else if (spyChange > 0.5) {
    return 'Markets advancing with positive breadth. Current levels suggest constructive technical setup for continuation higher.';
  } else if (spyChange < -1.0 || vixLevel > 22) {
    return 'Elevated selling pressure and increased volatility warrant defensive positioning. Key support levels critical for trend continuation.';
  } else if (spyChange < -0.5) {
    return 'Market weakness developing with distribution patterns emerging. Monitor key support zones for potential stabilization.';
  } else {
    return 'Markets trading in consolidation range. Await directional breakout above resistance or breakdown below support for next move.';
  }
}

/**
 * Helper: Get volatility description
 */
function getVolatilityDescription(vixLevel: number): string {
  if (vixLevel < 12) {
    return 'Exceptionally low volatility creates favorable conditions for trend following strategies. Remain alert for sudden reversals from complacency.';
  } else if (vixLevel < 15) {
    return 'Low volatility environment supports risk-taking and position building. Market participants showing confidence with muted fear levels.';
  } else if (vixLevel > 25) {
    return 'Heightened volatility signals significant uncertainty. Focus on capital preservation and high-conviction setups with tight risk management.';
  } else if (vixLevel > 20) {
    return 'Elevated volatility requires cautious approach. Wider stop losses and reduced position sizing recommended until conditions normalize.';
  } else {
    return 'Moderate volatility levels provide balanced risk-reward environment. Standard position sizing and risk parameters appropriate.';
  }
}

/**
 * Helper: Get momentum description
 */
function getMomentumDescription(qqqChange: number, spyChange: number, divergence: number): string {
  if (divergence < 0.3) {
    return 'Growth and value sectors moving in tandem, indicating broad market participation and healthy rotation dynamics.';
  } else if (qqqChange > spyChange + 0.5) {
    return 'Growth stocks significantly outperforming value, suggesting risk-on sentiment and investor preference for high-beta names.';
  } else {
    return 'Noticeable divergence between growth and value sectors. Monitor for potential sector rotation or mean reversion opportunities.';
  }
}

/**
 * Helper: Get sector name from ETF symbol
 */
function getSectorName(symbol: string): string {
  const sectorMap: Record<string, string> = {
    'XLK': 'Technology',
    'XLF': 'Financials',
    'XLV': 'Healthcare',
    'XLE': 'Energy',
    'XLY': 'Consumer Discretionary',
    'XLI': 'Industrials',
    'XLU': 'Utilities',
    'XLRE': 'Real Estate',
    'XLB': 'Materials',
    'XLP': 'Consumer Staples',
  };
  
  return sectorMap[symbol] || symbol;
}
