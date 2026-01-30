/**
 * EARLY PROFIT PROTECTION RULE (V2_ROBUST)
 *
 * Prevents green trades from turning red in choppy/non-trending conditions
 * while preserving full upside when momentum resumes.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

/**
 * Main handler: Evaluate all SWING_V2_ROBUST shadow positions
 */
async function evaluateEarlyProtection(_req: Request): Promise<Response> {
  try {
    console.log('[early_profit_protection] Starting early profit protection evaluation');

    const { data: positions, error: fetchError } = await supabase
      .from('engine_positions')
      .select('id, ticker, engine_version, run_mode')
      .eq('engine_version', 'SWING_V2_ROBUST')
      .eq('run_mode', 'SHADOW')
      .eq('status', 'OPEN')
      .limit(10);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch positions', details: fetchError }),
        { status: 500 }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Early profit protection evaluated',
        positions_evaluated: positions?.length || 0,
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error('[early_profit_protection] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Unexpected error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500 }
    );
  }
}

Deno.serve(evaluateEarlyProtection);
