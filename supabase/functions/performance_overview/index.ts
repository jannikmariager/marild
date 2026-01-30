/**
 * Performance Overview Edge Function
 * 
 * GET /performance/overview?timeFrame=YTD|1Y|6M|3M|1M|ALL
 * 
 * Returns model portfolio performance metrics with Pro/trial gating.
 * Performance is calculated using standardized trading rules, not real user data.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { getUserSubscriptionStatus, hasProAccess } from '../_shared/subscription_checker.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const timeFrame = url.searchParams.get('timeFrame') || 'YTD';

    // Validate timeframe
    const validTimeframes = ['YTD', '1Y', '6M', '3M', '1M', 'ALL'];
    if (!validTimeframes.includes(timeFrame)) {
      return new Response(
        JSON.stringify({ error: 'invalid_timeframe', message: 'Must be YTD, 1Y, 6M, 3M, 1M, or ALL' }),
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

    // Check subscription status using shared subscription_checker
    const subscriptionStatus = userId
      ? await getUserSubscriptionStatus(supabase, userId)
      : { tier: 'free', trial_ends_at: null, has_access: false };

    const hasPro = hasProAccess(subscriptionStatus);

    if (!hasPro) {
      return new Response(
        JSON.stringify({
          is_locked: true,
          is_trial: subscriptionStatus.tier === 'trial',
          is_pro: subscriptionStatus.tier === 'pro',
          message: 'Performance analytics are available for Pro subscribers and trial users',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate trial days remaining if applicable
    const trialDaysRemaining = subscriptionStatus.tier === 'trial' && subscriptionStatus.trial_ends_at
      ? Math.ceil((new Date(subscriptionStatus.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : undefined;

    const access = {
      is_locked: false,
      is_trial: subscriptionStatus.tier === 'trial',
      is_pro: subscriptionStatus.tier === 'pro',
      trial_days_remaining: trialDaysRemaining,
    };

    // Fetch latest snapshot for selected timeframe
    const { data: snapshot, error: snapshotError } = await supabase
      .from('performance_overview_snapshots')
      .select('*')
      .eq('time_frame', timeFrame)
      .order('as_of_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshotError) {
      console.error('Error fetching snapshot:', snapshotError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch performance data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!snapshot) {
      return new Response(
        JSON.stringify({
          ...access,
          message: 'No performance data available yet. Check back after the next daily update.',
          snapshot: null,
          equity_curve: [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch equity curve data
    const { data: equityPoints, error: equityError } = await supabase
      .from('performance_equity_points')
      .select('t, strategy_equity, benchmark_equity')
      .eq('snapshot_id', snapshot.id)
      .order('t', { ascending: true });

    if (equityError) {
      console.error('Error fetching equity curve:', equityError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch equity curve' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return full performance data
    return new Response(
      JSON.stringify({
        ...access,
        snapshot: {
          id: snapshot.id,
          as_of_date: snapshot.as_of_date,
          time_frame: snapshot.time_frame,
          strategy_return: Number(snapshot.strategy_return),
          benchmark_symbol: snapshot.benchmark_symbol,
          benchmark_return: Number(snapshot.benchmark_return),
          win_rate: Number(snapshot.win_rate),
          avg_trade_return: Number(snapshot.avg_trade_return),
          best_trade_return: Number(snapshot.best_trade_return),
          worst_trade_return: Number(snapshot.worst_trade_return),
          max_drawdown: Number(snapshot.max_drawdown),
          sample_size: snapshot.sample_size,
          tp_hit_rate: Number(snapshot.tp_hit_rate),
          updated_at: snapshot.updated_at,
        },
        equity_curve: equityPoints?.map(point => ({
          t: point.t,
          strategy_equity: Number(point.strategy_equity),
          benchmark_equity: Number(point.benchmark_equity),
        })) || [],
        disclaimer: 'Hypothetical model performance based on standardized system rules.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Performance overview error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
