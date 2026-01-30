/**
 * Edge Function: get_backtest_engine
 * Returns engine version and approval status for a symbol
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { symbol, engineType, timeframe } = await req.json();

    if (!symbol || !engineType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: symbol, engineType' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let engineVersion: string | null = null;
    let approved = false;

    // Query appropriate table based on engine type
    switch (engineType) {
      case 'DAYTRADER': {
        const { data, error } = await supabase
          .from('signal_engines')
          .select('engine_version, enabled')
          .eq('ticker', symbol)
          .eq('engine_type', 'DAYTRADER')
          .eq('enabled', true)
          .limit(1)
          .single();

        if (data && !error) {
          engineVersion = data.engine_version;
          approved = true;
        }
        break;
      }

      case 'SWING': {
        const { data, error } = await supabase
          .from('engine_routing')
          .select('engine_version, enabled')
          .eq('ticker', symbol)
          .eq('mode', 'SWING')
          .eq('enabled', true)
          .limit(1)
          .single();

        if (data && !error) {
          engineVersion = data.engine_version;
          approved = true;
        }
        break;
      }

      case 'INVESTOR': {
        const { data, error } = await supabase
          .from('signal_engines_investing')
          .select('engine_version, enabled')
          .eq('ticker', symbol)
          .eq('enabled', true)
          .limit(1)
          .single();

        if (data && !error) {
          engineVersion = data.engine_version;
          approved = true;
        }
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid engineType' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (!approved || !engineVersion) {
      return new Response(
        JSON.stringify({
          approved: false,
          engineVersion: null,
          message: 'Symbol not approved for this engine type',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        approved: true,
        engineVersion,
        symbol,
        engineType,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('get_backtest_engine error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
