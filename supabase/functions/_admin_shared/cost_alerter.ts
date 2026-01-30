/**
 * AI Cost Monitoring & Alerting
 * Feature Flag: FEATURE_AI_FALLBACKS (default: false)
 * 
 * Monitors daily AI spending and sends alerts when thresholds are exceeded
 * Safe: No-op when feature flag is disabled
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendDiscordAlert } from './discord_helper.ts';

/**
 * Check if cost monitoring is enabled
 */
function isEnabled(): boolean {
  return Deno.env.get('FEATURE_AI_FALLBACKS') === 'true';
}

/**
 * Check AI costs and send alerts if thresholds exceeded
 */
export async function checkAiCosts(): Promise<void> {
  if (!isEnabled()) {
    console.log('[cost_alerter] Disabled via feature flag (FEATURE_AI_FALLBACKS=false)');
    return;
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Get today's AI costs from ai_usage_logs
    const today = new Date().toISOString().split('T')[0];
    
    const { data: costs, error } = await supabase
      .from('ai_usage_logs')
      .select('cost_usd, model, task')
      .gte('created_at', `${today}T00:00:00Z`)
      .lte('created_at', `${today}T23:59:59Z`);
    
    if (error) {
      console.error('[cost_alerter] Error fetching costs:', error);
      return;
    }
    
    if (!costs || costs.length === 0) {
      console.log('[cost_alerter] No AI usage today');
      return;
    }
    
    // Calculate totals
    const dailyTotal = costs.reduce((sum, row) => sum + (row.cost_usd || 0), 0);
    
    // Group by model
    const byModel = costs.reduce((acc, row) => {
      const model = row.model || 'unknown';
      acc[model] = (acc[model] || 0) + (row.cost_usd || 0);
      return acc;
    }, {} as Record<string, number>);
    
    // Group by task
    const byTask = costs.reduce((acc, row) => {
      const task = row.task || 'unknown';
      acc[task] = (acc[task] || 0) + (row.cost_usd || 0);
      return acc;
    }, {} as Record<string, number>);
    
    console.log(`[cost_alerter] Daily AI cost: $${dailyTotal.toFixed(2)}`);
    console.log(`[cost_alerter] By model:`, byModel);
    console.log(`[cost_alerter] By task:`, byTask);
    
    // Alert thresholds
    const WARNING_THRESHOLD = 25;  // $25/day
    const CRITICAL_THRESHOLD = 50; // $50/day
    
    if (dailyTotal > CRITICAL_THRESHOLD) {
      // Critical alert
      await sendDiscordAlert({
        severity: 'CRITICAL',
        message: `🚨 CRITICAL: Daily AI costs at $${dailyTotal.toFixed(2)} (threshold: $${CRITICAL_THRESHOLD})`,
        metadata: {
          date: today,
          total_cost: dailyTotal,
          threshold: CRITICAL_THRESHOLD,
          by_model: byModel,
          by_task: byTask,
          request_count: costs.length
        }
      }).catch(err => {
        console.error('[cost_alerter] Failed to send critical alert:', err);
      });
    } else if (dailyTotal > WARNING_THRESHOLD) {
      // Warning alert
      await sendDiscordAlert({
        severity: 'HIGH',
        message: `⚠️ Daily AI costs at $${dailyTotal.toFixed(2)} (threshold: $${WARNING_THRESHOLD})`,
        metadata: {
          date: today,
          total_cost: dailyTotal,
          threshold: WARNING_THRESHOLD,
          by_model: byModel,
          request_count: costs.length
        }
      }).catch(err => {
        console.error('[cost_alerter] Failed to send warning alert:', err);
      });
    }
    
  } catch (error) {
    console.error('[cost_alerter] Unexpected error:', error);
  }
}

/**
 * Run cost check (can be called from cron job)
 */
export async function runCostCheck(): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (!isEnabled()) {
    return new Response(
      JSON.stringify({ 
        status: 'disabled',
        message: 'Cost alerting disabled (FEATURE_AI_FALLBACKS=false)'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  await checkAiCosts();

  return new Response(
    JSON.stringify({ 
      status: 'completed',
      timestamp: new Date().toISOString()
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
