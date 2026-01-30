/**
 * Expire Trials Edge Function
 * 
 * Scheduled function that runs hourly to automatically expire
 * trials that have passed their trial_ends_at date.
 * 
 * Schedule: Every hour (0 * * * *)
 * Purpose: Mark expired trials as 'expired' tier
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date().toISOString();

    console.log('[ExpireTrials] Starting trial expiration check...');
    console.log('[ExpireTrials] Current time:', now);

    // Find all trials that have expired
    const { data: expiredUsers, error: selectError } = await supabase
      .from('user_profile')
      .select('user_id, trial_ends_at, subscription_tier')
      .eq('subscription_tier', 'trial')
      .lt('trial_ends_at', now);

    if (selectError) {
      console.error('[ExpireTrials] Error fetching expired trials:', selectError);
      throw selectError;
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      console.log('[ExpireTrials] No expired trials found');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No expired trials to process',
          expired_count: 0,
          timestamp: now,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`[ExpireTrials] Found ${expiredUsers.length} expired trials`);

    // Update all expired trials to 'expired' tier
    const { data: updatedUsers, error: updateError } = await supabase
      .from('user_profile')
      .update({ subscription_tier: 'expired' })
      .eq('subscription_tier', 'trial')
      .lt('trial_ends_at', now)
      .select('user_id');

    if (updateError) {
      console.error('[ExpireTrials] Error updating expired trials:', updateError);
      throw updateError;
    }

    const expiredCount = updatedUsers?.length || 0;
    console.log(`[ExpireTrials] Successfully expired ${expiredCount} trials`);

    // Log details for monitoring
    expiredUsers.forEach((user) => {
      console.log(`[ExpireTrials] Expired: user_id=${user.user_id}, trial_ended=${user.trial_ends_at}`);
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Expired ${expiredCount} trials`,
        expired_count: expiredCount,
        expired_user_ids: updatedUsers?.map((u) => u.user_id) || [],
        timestamp: now,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[ExpireTrials] Function error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'internal_error',
        message: error.message || 'Failed to expire trials',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
