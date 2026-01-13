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
            signals: [],
            access: {
              is_locked: true,
            has_pro_access: true,
            },
          },
          { status: 403 }
        );
      }

      userId = session.user.id;

      // Canonical subscription status from users table
      const { data: userRow, error: userError } = await supabase
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', userId)
        .maybeSingle();

      if (userError) {
        console.error('[Trending Signals API] Failed to load user row for gating:', userError);
      }

      const isPro = userRow?.subscription_tier === 'pro';

      if (!isPro) {
        return NextResponse.json(
          {
            signals: [],
            access: {
              is_locked: true,
              has_pro_access: false,
            },
          },
          { status: 403 }
        );
      }
    }

    // Fetch trending signals from database
    // Get top 5-10 signals ordered by confidence and created_at
    const { data: signals, error: signalsError } = await supabase
      .from('ai_signals')
      .select('*')
      // NOTE: We intentionally do NOT filter on visibility_state here. The
      // visibility evaluator uses null / 'app_only' / 'app_discord' etc.
      // A simple .neq('hidden') would also filter out nulls, which is wrong
      // for freshly-generated signals like the ones we want to surface here.
      .order('confidence_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);

    if (signalsError) {
      console.error('[Trending Signals API] Database error:', signalsError);
      // Return empty signals instead of throwing
      return NextResponse.json(
        {
          signals: [],
          access: {
            is_locked: false,
            has_pro_access: true,
          },
        },
        { status: 200 }
      );
    }

    if (!signals || signals.length === 0) {
      // In dev mode, return sample signals for UI testing
      if (DEV_FORCE_PRO) {
        const sampleSignals = [
          {
            symbol: 'AAPL',
            action: 'buy' as const,
            confidence: 87,
            timeframe: '1D',
            change_today: 1.25,
            summary: 'Strong momentum with bullish setup',
            updated_at: new Date().toISOString(),
          },
          {
            symbol: 'TSLA',
            action: 'sell' as const,
            confidence: 76,
            timeframe: '4H',
            change_today: -0.84,
            summary: 'Bearish reversal pattern detected',
            updated_at: new Date().toISOString(),
          },
          {
            symbol: 'MSFT',
            action: 'buy' as const,
            confidence: 82,
            timeframe: '1D',
            change_today: 0.95,
            summary: 'Breakout above resistance',
            updated_at: new Date().toISOString(),
          },
          {
            symbol: 'NVDA',
            action: 'buy' as const,
            confidence: 91,
            timeframe: '1W',
            change_today: 2.14,
            summary: 'Strong uptrend continuation',
            updated_at: new Date().toISOString(),
          },
          {
            symbol: 'META',
            action: 'sell' as const,
            confidence: 73,
            timeframe: '1D',
            change_today: -1.32,
            summary: 'Overbought conditions',
            updated_at: new Date().toISOString(),
          },
        ];

        return NextResponse.json({
          signals: sampleSignals,
      access: {
        is_locked: false,
        has_pro_access: false,
      },
        });
      }

      return NextResponse.json(
        {
          signals: [],
          access: {
            is_locked: false,
            has_pro_access: true,
          },
        },
        { status: 200 }
      );
    }

    // Get current prices for change calculation
    const symbols = [...new Set(signals.map(s => s.symbol))];
    const { data: quotes } = await supabase
      .from('market_quotes')
      .select('symbol, current_price, change_percent')
      .in('symbol', symbols);

    const quoteMap = new Map(quotes?.map(q => [q.symbol, q]) || []);

    // Transform signals to match expected format
    const transformedSignals = signals.slice(0, 5).map((signal) => {
      const quote = quoteMap.get(signal.symbol);
      const isBuy = signal.signal_type?.toLowerCase().includes('buy') || 
                    signal.action?.toLowerCase() === 'buy';

      return {
        symbol: signal.symbol,
        action: isBuy ? 'buy' : 'sell',
        confidence: Math.round((signal.confidence || 0) * 100),
        timeframe: signal.timeframe || '1D',
        change_today: quote?.change_percent || 0,
        summary: signal.reasoning?.split('.')[0] || 'AI signal detected',
        updated_at: signal.created_at || new Date().toISOString(),
      };
    });

    return NextResponse.json({
      signals: transformedSignals,
      access: {
        is_locked: false,
        has_pro_access: true,
      },
    });
  } catch (error: any) {
    console.error('[Trending Signals API] Error:', error);
    return NextResponse.json(
      {
        error: 'SYSTEM_ERROR',
        message: error.message || 'Failed to fetch trending signals',
        signals: [],
        access: {
          is_locked: false,
          has_pro_access: false,
        },
      },
      { status: 500 }
    );
  }
}
