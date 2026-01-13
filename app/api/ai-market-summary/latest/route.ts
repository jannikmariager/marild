import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get user session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    // In dev mode, bypass auth checks if DEV_FORCE_PRO is enabled
    if (!DEV_FORCE_PRO) {
      if (sessionError || !session) {
        return NextResponse.json(
          {
            access: {
              is_locked: true,
              has_pro_access: false,
            },
          },
          { status: 403 }
        );
      }

      const userId = session.user.id;

      // Canonical subscription status from users table
      const { data: userRow, error: userError } = await supabase
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', userId)
        .maybeSingle();

      if (userError) {
        console.error('[AI Market Summary API] Failed to load user row for gating:', userError);
      }

      const isPro = userRow?.subscription_tier === 'pro';

      if (!isPro) {
        return NextResponse.json(
          {
            access: {
              is_locked: true,
              has_pro_access: false,
            },
          },
          { status: 403 }
        );
      }
    }

    // Call the Edge Function
    const { data, error } = await supabase.functions.invoke('ai_market_summary', {
      body: {},
    });

    if (error) {
      console.error('[AI Market Summary API] Edge function error:', error);
      
      // Handle specific errors
      if (error.message?.includes('NO_DATA') || error.message?.includes('404')) {
        return NextResponse.json(
          { error: 'NO_DATA', message: 'No AI market summary available yet' },
          { status: 404 }
        );
      }

      // In DEV with PRO override, surface a safe placeholder rather than a hard failure
      if (DEV_FORCE_PRO) {
        const placeholder = {
          headline: 'Market overview unavailable (DEV placeholder)',
          market_trend: ['Waiting for live AI market summary data.'],
          volatility_risk: ['Volatility data unavailable in dev placeholder.'],
          sentiment_signals: ['No sentiment signals available.'],
          insight: 'AI market summary edge function is not returning data in dev. This is a safe fallback.',
          summary_label: 'neutral',
          as_of: new Date().toISOString(),
          access: {
            is_locked: false,
            has_pro_access: true,
          },
        } as const;

        return NextResponse.json(placeholder);
      }

      throw error;
    }

    // If no data returned
    if (!data) {
      return NextResponse.json(
        { error: 'NO_DATA', message: 'No AI market summary available yet' },
        { status: 404 }
      );
    }

    // Transform the Edge Function response to match the component schema
    const transformedData = {
      headline: data.summary || 'Market Overview',
      market_trend: data.key_points?.slice(0, 2) || [
        'Market showing mixed signals',
        'Monitoring key support levels',
      ],
      volatility_risk: [
        data.metrics
          ? `VIX at ${data.metrics.vix_level.toFixed(1)}`
          : 'Volatility within normal ranges',
      ],
      sentiment_signals: data.key_points?.slice(2, 4) || [
        'Neutral positioning across sectors',
      ],
      insight:
        data.sentiment === 'bullish'
          ? 'Market conditions favor selective long positions'
          : data.sentiment === 'bearish'
          ? 'Exercise caution and prioritize capital preservation'
          : 'Wait for clearer directional signals',
      summary_label: data.sentiment || 'neutral',
      as_of: data.updated_at || new Date().toISOString(),
      access: {
        is_locked: false,
        has_pro_access: true,
      },
    };

    return NextResponse.json(transformedData);
  } catch (error: any) {
    console.error('[AI Market Summary API] Error:', error);

    if (DEV_FORCE_PRO) {
      const placeholder = {
        headline: 'Market overview unavailable (DEV placeholder)',
        market_trend: ['Waiting for live AI market summary data.'],
        volatility_risk: ['Volatility data unavailable in dev placeholder.'],
        sentiment_signals: ['No sentiment signals available.'],
        insight: 'AI market summary edge function is not returning data in dev. This is a safe fallback.',
        summary_label: 'neutral',
        as_of: new Date().toISOString(),
        access: {
          is_locked: false,
          has_pro_access: true,
        },
      } as const;

      return NextResponse.json(placeholder);
    }

    return NextResponse.json(
      {
        error: 'SYSTEM_ERROR',
        message: error.message || 'Failed to fetch AI market summary',
      },
      { status: 500 }
    );
  }
}
