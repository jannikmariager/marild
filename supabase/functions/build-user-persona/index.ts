import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

// User persona type definition
export type UserPersona = {
  experienceLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tradingStyle: 'long_term_builder' | 'swing_trader' | 'active_trader' | 'opportunistic';
  interests: string[];
  regions: string[];
  cryptoEnabled: boolean;
  notificationFrequency: 'daily' | 'few_per_week' | 'important_only' | 'never';
};

/**
 * Build user persona from profile and markets data
 * This is used to personalize AI responses throughout the app
 */
export function buildUserPersona(profile: any, markets: any): UserPersona {
  return {
    experienceLevel: profile?.experience_level || 'intermediate',
    tradingStyle: profile?.trading_style || 'long_term_builder',
    interests: profile?.preferences || [],
    regions: markets?.regions || [],
    cryptoEnabled: markets?.crypto_enabled ?? false,
    notificationFrequency: profile?.notification_frequency || 'few_per_week',
  };
}

/**
 * Supabase Edge Function: Build User Persona
 * Fetches user profile and markets data, builds personalized persona
 */
serve(async (req) => {
  try {
    // CORS headers
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get user ID from JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fetch profile and markets data
    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', user.id)
      .single()

    const { data: markets, error: marketsError } = await supabase
      .from('user_markets')
      .select('*')
      .eq('user_id', user.id)
      .single()

    // Build persona (even if some data is missing, use defaults)
    const persona = buildUserPersona(profile, markets)

    return new Response(
      JSON.stringify({ 
        persona,
        profile: profile || null,
        markets: markets || null,
      }), 
      {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  } catch (error) {
    console.error('Error in build-user-persona:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
