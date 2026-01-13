import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    // Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ access: { is_locked: true }, summary: null });
    }

    // PRO gating (skip DB fetch for free/expired)
    const { data: subStatus } = await supabase
      .from('subscription_status')
      .select('tier')
      .eq('user_id', user.id)
      .maybeSingle();


    const isPro = subStatus?.tier === 'pro';
    const hasAccess = hasProAccess(isPro);

    if (!hasAccess) {
      return NextResponse.json({ access: { is_locked: true }, summary: null });
    }

    // Today in UTC
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const start = `${yyyy}-${mm}-${dd}T00:00:00+00:00`;
    const end = `${yyyy}-${mm}-${dd}T23:59:59.999999+00:00`;

    // Fetch today's executed trades from performance engine
    const { data: trades, error: tradesError } = await supabase
      .from('ai_performance_trades')
      .select('symbol, pnl_pct, exit_time, result')
      .not('result', 'eq', 'OPEN')
      .gte('exit_time', start)
      .lt('exit_time', end);

    if (tradesError) {
      console.error('[performance/today-activity] Error fetching trades:', tradesError);
      return NextResponse.json(
        { access: { is_locked: false }, summary: null },
        { status: 500 }
      );
    }

    const cleaned = (trades || []).filter((t) => t.pnl_pct !== null);
    const totalTrades = cleaned.length;

    if (totalTrades === 0) {
      return NextResponse.json({ access: { is_locked: false }, summary: null });
    }

    const winners = cleaned.filter((t) => (t.pnl_pct as number) > 0);
    const losers = cleaned.filter((t) => (t.pnl_pct as number) < 0);

    let best = cleaned[0];
    let worst = cleaned[0];

    for (const t of cleaned) {
      if ((t.pnl_pct as number) > (best.pnl_pct as number)) best = t;
      if ((t.pnl_pct as number) < (worst.pnl_pct as number)) worst = t;
    }

    return NextResponse.json({
      access: { is_locked: false },
      summary: {
        totalTrades,
        winners: winners.length,
        losers: losers.length,
        best: {
          symbol: best.symbol,
          pnl_pct: best.pnl_pct,
        },
        worst: {
          symbol: worst.symbol,
          pnl_pct: worst.pnl_pct,
        },
      },
    });
  } catch (error) {
    console.error('[performance/today-activity] Unexpected error:', error);
    return NextResponse.json(
      { access: { is_locked: false }, summary: null },
      { status: 500 }
    );
  }
}