/**
 * Performance What-If Edge Function
 * 
 * GET /performance_whatif?window=10
 * 
 * Simulates performance if user followed the last X signals.
 * PRO feature with trial access, controlled by subscription + devForcePro.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { getUserSubscriptionStatus, hasProAccess, createLockedResponse } from '../_shared/subscription_checker.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EquityPoint {
  t: string;
  equity: number;
}

interface WhatIfResponse {
  window: number;
  total_return_pct: number;
  win_rate: number;
  wins: number;
  losses: number;
  best_symbol: string | null;
  worst_symbol: string | null;
  best_return: number;
  worst_return: number;
  equity_curve: EquityPoint[];
  cached: boolean;
  locked?: boolean;
  tier?: string;
  message?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const windowParam = url.searchParams.get('window') || '10';
    const window = parseInt(windowParam, 10);

    // Validate window
    if (isNaN(window) || window < 1 || window > 100) {
      return new Response(
        JSON.stringify({ error: 'invalid_window', message: 'Window must be between 1 and 100' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
          message: 'Authentication required to access What-If Performance',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subscriptionStatus = await getUserSubscriptionStatus(userId, supabaseUrl, supabaseKey);
    const hasPro = hasProAccess(subscriptionStatus);

    if (!hasPro) {
      const lockedResponse = createLockedResponse('What-If Performance', subscriptionStatus);
      return new Response(
        JSON.stringify(lockedResponse),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check cache first (15 minute TTL)
    const cacheKey = `whatif_${window}`;
    const { data: cached } = await supabase
      .from('ai_cache')
      .select('cached_data, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 15 * 60 * 1000) {
        console.log(`[WhatIf] Cache HIT for window=${window}`);
        return new Response(
          JSON.stringify({ ...cached.cached_data, cached: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[WhatIf] Cache MISS for window=${window}, computing...`);

    // Fetch last X signals with price data
    const { data: signals, error: signalsError } = await supabase
      .from('ai_signals')
      .select('symbol, signal_type, entry_price, stop_loss, take_profit_1, take_profit_2, created_at')
      .not('entry_price', 'is', null)
      .order('created_at', { ascending: false })
      .limit(window);

    if (signalsError) {
      console.error('Error fetching signals:', signalsError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch signal data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!signals || signals.length === 0) {
      console.error('[WhatIf] No signals available');
      return new Response(
        JSON.stringify({
          error: 'NO_DATA',
          message: 'Performance data not available right now',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // TODO: Implement actual historical price lookup to calculate real returns
    // For now, return error instead of mock/random data
    console.error('[WhatIf] Historical price data not yet implemented');
    return new Response(
      JSON.stringify({
        error: 'NO_DATA',
        message: 'Performance data not available right now',
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Performance what-if error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
