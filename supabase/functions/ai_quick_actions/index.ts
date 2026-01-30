// Edge Function: ai_quick_actions
// Returns curated AI action buttons (NO chat input)
// PRO gating with DEV_FORCE_PRO override
// No caching needed (static data)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  getUserSubscriptionStatus,
  hasProAccess,
} from '../_shared/subscription_checker.ts';

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  category: 'analysis' | 'scan' | 'research';
  route?: string; // Optional deep link route
  description?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check subscription status
    const subscriptionStatus = await getUserSubscriptionStatus(
      supabase,
      user.id
    );
    const isPro = hasProAccess(subscriptionStatus);

    // If user doesn't have PRO access, return locked state
    if (!isPro) {
      return new Response(
        JSON.stringify({
          access: {
            is_locked: true,
            reason: 'pro_required',
            message:
              'Quick AI Actions are available with TradeLens Pro. Start your free trial to unlock.',
          },
          actions: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Define curated quick actions - ordered for balanced row widths
    const actions: QuickAction[] = [
      // Row 1: Shorter labels (better fit)
      {
        id: 'analyze-watchlist',
        label: 'Analyze Watchlist',
        icon: 'target',
        category: 'analysis',
        description: 'AI analysis of your watchlist stocks',
      },
      {
        id: 'find-bullish-setups',
        label: 'Bullish Setups',
        icon: 'trendingUp',
        category: 'scan',
        description: 'Scan for high-confidence buy signals',
      },
      {
        id: 'scan-breakouts',
        label: 'Scan Breakouts',
        icon: 'zap',
        category: 'scan',
        description: 'Identify stocks breaking key resistance',
      },
      {
        id: 'find-bearish-setups',
        label: 'Bearish Setups',
        icon: 'trendingDown',
        category: 'scan',
        description: 'Scan for high-confidence sell signals',
      },
      {
        id: 'find-oversold-stocks',
        label: 'Find Oversold',
        icon: 'trendingDown',
        category: 'scan',
        description: 'Identify oversold reversal opportunities',
      },
      {
        id: 'find-overbought-stocks',
        label: 'Find Overbought',
        icon: 'trendingUp',
        category: 'scan',
        description: 'Identify overbought stocks',
      },
      {
        id: 'detect-trend-reversals',
        label: 'Trend Reversals',
        icon: 'activity',
        category: 'analysis',
        description: 'Detect bullish & bearish reversals',
      },
      // Row 2: Longer labels
      {
        id: 'check-sector-rotation',
        label: 'Sector Rotation',
        icon: 'pieChart',
        category: 'research',
        description: 'See which sectors are leading',
      },
      {
        id: 'review-portfolio-risk',
        label: 'Portfolio Risk',
        icon: 'shield',
        category: 'analysis',
        description: 'AI risk assessment of your holdings',
      },
      {
        id: 'upcoming-earnings',
        label: 'Upcoming Earnings',
        icon: 'calendar',
        category: 'research',
        description: 'See upcoming earnings this week',
      },
      {
        id: 'volatility-risk-regime',
        label: 'Volatility Regime',
        icon: 'zap',
        category: 'analysis',
        description: 'Analyze current volatility environment',
      },
      {
        id: 'macro-briefing',
        label: 'Macro Briefing',
        icon: 'pieChart',
        category: 'research',
        description: 'AI macro market overview',
      },
      {
        id: 'find-momentum-leaders',
        label: 'Momentum Leaders',
        icon: 'trendingUp',
        category: 'scan',
        description: 'Find strongest momentum stocks',
      },
      {
        id: 'high-short-interest',
        label: 'Short Squeeze',
        icon: 'zap',
        category: 'scan',
        description: 'High short interest opportunities',
      },
      {
        id: 'analyze-market-sentiment',
        label: 'Market Sentiment',
        icon: 'activity',
        category: 'analysis',
        description: 'Analyze overall market fear/greed',
      },
    ];

    return new Response(
      JSON.stringify({
        actions,
        access: {
          is_locked: false,
        },
        cached: false,
        generated_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in ai_quick_actions:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
