/**
 * Performance Trades Edge Function
 * 
 * GET /performance/trades?timeFrame=YTD&page=1&pageSize=50
 * 
 * Returns paginated list of individual trades from the backtest.
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
    const url = new URL(req.url);
    const timeFrame = url.searchParams.get('timeFrame') || 'YTD';
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50');

    // Validate parameters
    const validTimeframes = ['YTD', '1Y', '6M', '3M', '1M', 'ALL'];
    if (!validTimeframes.includes(timeFrame)) {
      return new Response(
        JSON.stringify({ error: 'invalid_timeframe' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return new Response(
        JSON.stringify({ error: 'invalid_pagination' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get latest snapshot for timeframe
    const { data: snapshot, error: snapshotError } = await supabase
      .from('performance_overview_snapshots')
      .select('id')
      .eq('time_frame', timeFrame)
      .order('as_of_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshotError || !snapshot) {
      return new Response(
        JSON.stringify({
          trades: [],
          pagination: { page, pageSize, total: 0, totalPages: 0 },
          message: 'No performance data available',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Count total trades
    const { count, error: countError } = await supabase
      .from('performance_trades')
      .select('*', { count: 'exact', head: true })
      .eq('snapshot_id', snapshot.id);

    if (countError) {
      console.error('Error counting trades:', countError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to count trades' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / pageSize);

    // Fetch paginated trades
    const { data: trades, error: tradesError } = await supabase
      .from('performance_trades')
      .select('*')
      .eq('snapshot_id', snapshot.id)
      .order('entry_time', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (tradesError) {
      console.error('Error fetching trades:', tradesError);
      return new Response(
        JSON.stringify({ error: 'db_error', message: 'Failed to fetch trades' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format trades
    const formattedTrades = trades?.map(trade => ({
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      entry_price: Number(trade.entry_price),
      exit_price: Number(trade.exit_price),
      return_pct: Number(trade.return_pct),
      holding_period_bars: trade.holding_period_bars,
      tp_hit: trade.tp_hit,
      confidence_score: trade.confidence_score ? Number(trade.confidence_score) : null,
      sector: trade.sector,
      timeframe: trade.timeframe,
    })) || [];

    return new Response(
      JSON.stringify({
        trades: formattedTrades,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Performance trades error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
