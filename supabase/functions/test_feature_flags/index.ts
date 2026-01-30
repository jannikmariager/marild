/**
 * Test Feature Flags
 * Returns the current state of all feature flags
 * PUBLIC - No auth required
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve({ 
  onListen: () => console.log('[test_feature_flags] Listening...'),
}, async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const flags = {
    FEATURE_ERROR_CODES: Deno.env.get('FEATURE_ERROR_CODES') || 'not set',
    FEATURE_TIERED_CACHING: Deno.env.get('FEATURE_TIERED_CACHING') || 'not set',
    FEATURE_AI_FALLBACKS: Deno.env.get('FEATURE_AI_FALLBACKS') || 'not set',
    FEATURE_RATE_LIMITING: Deno.env.get('FEATURE_RATE_LIMITING') || 'not set',
    FEATURE_ADMIN_ANALYTICS: Deno.env.get('FEATURE_ADMIN_ANALYTICS') || 'not set',
    FEATURE_FREE_TIER_LIMITS: Deno.env.get('FEATURE_FREE_TIER_LIMITS') || 'not set',
    FEATURE_IP_BANS: Deno.env.get('FEATURE_IP_BANS') || 'not set',
    FEATURE_NEW_UX: Deno.env.get('FEATURE_NEW_UX') || 'not set',
    FEATURE_SMC_TIERED_CACHE: Deno.env.get('FEATURE_SMC_TIERED_CACHE') || 'not set',
  };

  // Check which are enabled
  const enabled = Object.entries(flags)
    .filter(([_, value]) => value === 'true')
    .map(([key, _]) => key);

  const disabled = Object.entries(flags)
    .filter(([_, value]) => value !== 'true')
    .map(([key, value]) => ({ flag: key, value }));

  return new Response(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      all_flags: flags,
      enabled_flags: enabled,
      disabled_flags: disabled,
      summary: `${enabled.length}/${Object.keys(flags).length} flags enabled`,
    }, null, 2),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
