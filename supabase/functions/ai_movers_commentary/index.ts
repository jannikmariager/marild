/**
 * AI Movers Commentary Edge Function
 * 
 * POST /ai_movers_commentary
 * 
 * Returns AI-generated commentary on today's top market movers.
 * PRO feature with trial access.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { getUserSubscriptionStatus, hasProAccess } from '../_shared/subscription_checker.ts';
import { fetchBulkQuotes } from '../_shared/yahoo_v8_client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MoversCommentaryResponse {
  commentary: string;
  generated_at: string;
  cached: boolean;
  access: {
    is_locked: boolean;
    is_pro_or_trial: boolean;
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

    // Check authentication
    if (!userId) {
      return new Response(
        JSON.stringify({
          access: {
            is_locked: true,
            is_pro_or_trial: false,
          },
          message: 'Authentication required',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check subscription status
    const subscriptionStatus = await getUserSubscriptionStatus(userId, supabaseUrl, supabaseKey);
    const hasPro = hasProAccess(subscriptionStatus);

    if (!hasPro) {
      return new Response(
        JSON.stringify({
          access: {
            is_locked: true,
            is_pro_or_trial: false,
          },
          message: 'PRO subscription required',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check cache first (15 minute TTL)
    const cacheKey = 'ai_movers_commentary';
    const { data: cached } = await supabase
      .from('ai_cache')
      .select('cached_data, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 15 * 60 * 1000) { // 15 minutes
        console.log(`[MoversCommentary] Cache HIT`);
        return new Response(
          JSON.stringify({ ...cached.cached_data, cached: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[MoversCommentary] Cache MISS, generating commentary...`);

    // Fetch top movers from market_quotes table
    const { data: gainers } = await supabase
      .from('market_quotes')
      .select('symbol, change_percent')
      .gt('change_percent', 0)
      .order('change_percent', { ascending: false })
      .limit(5);

    const { data: losers } = await supabase
      .from('market_quotes')
      .select('symbol, change_percent')
      .lt('change_percent', 0)
      .order('change_percent', { ascending: true })
      .limit(5);

    // Generate commentary based on movers
    const commentary = generateMoversCommentary(gainers || [], losers || []);

    const response: MoversCommentaryResponse = {
      commentary,
      generated_at: new Date().toISOString(),
      cached: false,
      access: {
        is_locked: false,
        is_pro_or_trial: true,
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
    console.error('AI Movers Commentary error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Generate commentary based on top gainers and losers
 */
function generateMoversCommentary(
  gainers: Array<{ symbol: string; change_percent: number }>,
  losers: Array<{ symbol: string; change_percent: number }>
): string {
  if (gainers.length === 0 && losers.length === 0) {
    return 'Market showing limited movement today with muted trading activity across major indices.';
  }

  const topGainer = gainers[0];
  const topLoser = losers[0];
  
  const gainerText = topGainer 
    ? `${topGainer.symbol} leading gains with a ${topGainer.change_percent.toFixed(1)}% rally`
    : 'limited upside momentum';
    
  const loserText = topLoser
    ? `${topLoser.symbol} under pressure, down ${Math.abs(topLoser.change_percent).toFixed(1)}%`
    : 'contained downside moves';

  // Determine overall market tone
  const avgGainerMove = gainers.length > 0 
    ? gainers.reduce((sum, g) => sum + g.change_percent, 0) / gainers.length 
    : 0;
  const avgLoserMove = losers.length > 0
    ? losers.reduce((sum, l) => sum + Math.abs(l.change_percent), 0) / losers.length
    : 0;

  let marketTone: string;
  if (avgGainerMove > avgLoserMove * 1.5) {
    marketTone = 'Strong buying interest dominates with';
  } else if (avgLoserMove > avgGainerMove * 1.5) {
    marketTone = 'Selling pressure evident as';
  } else {
    marketTone = 'Mixed trading signals with';
  }

  return `${marketTone} ${gainerText}, while ${loserText}. Sector rotation continues as traders position ahead of key levels.`;
}
