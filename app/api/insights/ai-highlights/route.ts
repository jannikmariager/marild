import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

export async function GET() {
  try {
    const supabase = await createClient();

    // Get user session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    // In dev mode, bypass auth checks if DEV_FORCE_PRO is enabled
    let userId = session?.user?.id;

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

      userId = session.user.id;

      // Check subscription status
      const { data: subStatus } = await supabase
        .from('subscription_status')
        .select('tier')
        .eq('user_id', userId)
        .maybeSingle();

      const isPro = subStatus?.tier === 'pro';

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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const response = await fetch(`${supabaseUrl}/functions/v1/ai_highlights_today`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session?.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[AI Highlights API] Edge function error:', data);
      
      // Handle specific errors
      if (data.error === 'NO_DATA' || response.status === 404) {
        return NextResponse.json(
          { error: 'NO_DATA', message: 'No AI highlights available yet' },
          { status: 404 }
        );
      }

      // In DEV with PRO override, surface a safe placeholder instead of erroring
      if (DEV_FORCE_PRO) {
        const placeholder = {
          sentiment: 'neutral' as const,
          strongest_sector: {
            name: 'Technology',
            change: 0,
          },
          weakest_sector: {
            name: 'Energy',
            change: 0,
          },
          updated_at: new Date().toISOString(),
          access: {
            is_locked: false,
            has_pro_access: true,
          },
        };

        return NextResponse.json(placeholder);
      }

      throw new Error(data.message || 'Failed to fetch AI highlights');
    }

    // Transform the data to match the expected format
    // Ensure sectors have name and change properties
    const strongest = data.strongest_sector || {};
    const weakest = data.weakest_sector || {};

    const transformedData = {
      sentiment: data.ai_sentiment || data.sentiment || 'neutral',
      strongest_sector: {
        name: strongest.name || strongest || 'Technology',
        change: typeof strongest.change === 'number' ? strongest.change : 1.5,
      },
      weakest_sector: {
        name: weakest.name || weakest || 'Energy',
        change: typeof weakest.change === 'number' ? weakest.change : -0.8,
      },
      updated_at: data.updated_at || data.date || new Date().toISOString(),
      access: {
        is_locked: false,
        has_pro_access: true,
      },
    };

    return NextResponse.json(transformedData);
  } catch (error: any) {
    console.error('[AI Highlights API] Error:', error);

    if (DEV_FORCE_PRO) {
      const placeholder = {
        sentiment: 'neutral' as const,
        strongest_sector: {
          name: 'Technology',
          change: 0,
        },
        weakest_sector: {
          name: 'Energy',
          change: 0,
        },
        updated_at: new Date().toISOString(),
        access: {
          is_locked: false,
          has_pro_access: true,
        },
      };

      return NextResponse.json(placeholder);
    }

    return NextResponse.json(
      {
        error: 'SYSTEM_ERROR',
        message: error.message || 'Failed to fetch AI highlights',
      },
      { status: 500 }
    );
  }
}
