// @ts-nocheck
/**
 * Abuse Pattern Detector
 * Feature Flag: FEATURE_RATE_LIMITING (default: false)
 * 
 * Analyzes rate_limit_logs for abuse patterns and auto-bans IPs
 * Safe: No-op when feature flag is disabled
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendDiscordAlert } from './discord_helper.ts';

/**
 * Check if abuse detection is enabled
 */
function isEnabled(): boolean {
  return Deno.env.get('FEATURE_RATE_LIMITING') === 'true';
}

/**
 * Detect and respond to abuse patterns
 */
export async function detectAbusePatterns(supabase: SupabaseClient): Promise<void> {
  if (!isEnabled()) {
    console.log('[abuse_detector] Disabled via feature flag (FEATURE_RATE_LIMITING=false)');
    return;
  }

  try {
    // Check for IPs with >50 violations in last hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    
    const { data: logs, error } = await supabase
      .from('rate_limit_logs')
      .select('ip_address')
      .gte('timestamp', oneHourAgo);
    
    if (error) {
      console.error('[abuse_detector] Error fetching logs:', error);
      return;
    }
    
    if (!logs || logs.length === 0) {
      console.log('[abuse_detector] No violations in last hour');
      return;
    }
    
    // Count violations per IP
    const violationCounts = new Map<string, number>();
    logs.forEach(log => {
      const count = violationCounts.get(log.ip_address) || 0;
      violationCounts.set(log.ip_address, count + 1);
    });
    
    let bannedCount = 0;
    
    // Ban IPs with >50 violations
    for (const [ip, count] of violationCounts.entries()) {
      if (count > 50) {
        try {
          // Auto-ban for 24 hours
          const bannedUntil = new Date(Date.now() + 86400000).toISOString();
          
          await supabase.from('ip_bans').upsert({
            ip_address: ip,
            banned_until: bannedUntil,
            reason: `Auto-ban: ${count} violations in 1 hour`,
            created_by: 'abuse_detector',
            metadata: { violation_count: count, threshold: 50 }
          });
          
          bannedCount++;
          
          // Alert Discord
          await sendDiscordAlert({
            severity: 'HIGH',
            message: `🚨 IP ${ip} auto-banned for abuse (${count} violations in 1 hour)`,
            metadata: { 
              ip, 
              violation_count: count, 
              threshold: 50,
              banned_until: bannedUntil
            }
          }).catch(err => {
            console.error('[abuse_detector] Discord alert failed:', err);
          });
          
        } catch (banError) {
          console.error(`[abuse_detector] Failed to ban IP ${ip}:`, banError);
        }
      }
    }
    
    if (bannedCount > 0) {
      console.log(`[abuse_detector] Banned ${bannedCount} IPs for abuse`);
    } else {
      console.log('[abuse_detector] No abuse patterns detected');
    }
    
  } catch (error) {
    console.error('[abuse_detector] Unexpected error:', error);
  }
}

/**
 * Run abuse detection (can be called from cron job)
 */
export async function runAbuseDetection(): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (!isEnabled()) {
    return new Response(
      JSON.stringify({ 
        status: 'disabled',
        message: 'Abuse detection disabled (FEATURE_RATE_LIMITING=false)'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  await detectAbusePatterns(supabase);

  return new Response(
    JSON.stringify({ 
      status: 'completed',
      timestamp: new Date().toISOString()
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
