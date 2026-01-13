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
    if (!DEV_FORCE_PRO) {
      if (sessionError || !session) {
        return NextResponse.json(
          { latest_signal_time: null, count: 0 },
          { status: 200 }
        );
      }

      const userId = session.user.id;

      // Check subscription status
      const { data: subStatus } = await supabase
        .from('subscription_status')
        .select('tier')
        .eq('user_id', userId)
        .maybeSingle();

      const isPro = subStatus?.tier === 'pro';

      if (!isPro) {
        return NextResponse.json(
          { latest_signal_time: null, count: 0 },
          { status: 200 }
        );
      }
    }

    // Get the latest signal timestamp and count from last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentSignals, error } = await supabase
      .from('ai_signals')
      .select('created_at')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Check New Signals API] Error:', error);
      return NextResponse.json(
        { latest_signal_time: null, count: 0 },
        { status: 200 }
      );
    }

    if (!recentSignals || recentSignals.length === 0) {
      return NextResponse.json(
        { latest_signal_time: null, count: 0 },
        { status: 200 }
      );
    }

    return NextResponse.json({
      latest_signal_time: recentSignals[0].created_at,
      count: recentSignals.length,
    });
  } catch (error: any) {
    console.error('[Check New Signals API] Error:', error);
    return NextResponse.json(
      { latest_signal_time: null, count: 0 },
      { status: 200 }
    );
  }
}
