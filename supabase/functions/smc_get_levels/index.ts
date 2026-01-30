/**
 * SMC Get Levels Edge Function
 * Read-only endpoint to fetch latest SMC data
 * Returns Order Blocks, BOS events, and Session ranges
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker, timeframe = '1h' } = await req.json();

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

    // Fetch Order Blocks (limit to last 20, active first)
    const { data: orderBlocks, error: obError } = await supabase
      .from('smc_order_blocks')
      .select('*')
      .eq('ticker', ticker)
      .eq('timeframe', timeframe)
      .order('created_at', { ascending: false })
      .limit(20);

    if (obError) {
      console.error('Error fetching order blocks:', obError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch order blocks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch BOS Events (limit to last 15)
    const { data: bosEvents, error: bosError } = await supabase
      .from('smc_bos_events')
      .select('*')
      .eq('ticker', ticker)
      .eq('timeframe', timeframe)
      .order('event_time', { ascending: false })
      .limit(15);

    if (bosError) {
      console.error('Error fetching BOS events:', bosError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch BOS events' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch Session Ranges (last 5 days)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const { data: sessions, error: sessionError } = await supabase
      .from('smc_session_ranges')
      .select('*')
      .eq('ticker', ticker)
      .gte('session_date', fiveDaysAgo.toISOString().split('T')[0])
      .order('session_date', { ascending: false });

    if (sessionError) {
      console.error('Error fetching sessions:', sessionError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch sessions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if data exists, if not suggest running smc_calculate_levels first
    if (!orderBlocks || orderBlocks.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'no_data',
          message: 'No SMC data found. Run smc_calculate_levels first.',
          ticker,
          timeframe,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate AI summary (placeholder - will be enhanced by smc_get_trade_setups)
    const activeBullishOBs = orderBlocks.filter(
      ob => ob.direction === 'bullish' && !ob.mitigated
    );
    const activeBearishOBs = orderBlocks.filter(
      ob => ob.direction === 'bearish' && !ob.mitigated
    );

    const aiSummary = `${ticker} has ${activeBullishOBs.length} active bullish order blocks and ${activeBearishOBs.length} active bearish order blocks on the ${timeframe} timeframe. Latest BOS: ${
      bosEvents && bosEvents.length > 0 ? bosEvents[0].direction : 'none'
    }.`;

    return new Response(
      JSON.stringify({
        ticker,
        timeframe,
        order_blocks: orderBlocks,
        bos_events: bosEvents || [],
        sessions: sessions || [],
        ai_summary: aiSummary,
        updated_at: new Date().toISOString(),
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
