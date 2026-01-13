import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const url = new URL(request.url);
    const engineVersion = url.searchParams.get('engineVersion') ?? 'v7.4';

    // Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.warn('[performance/universe] Auth error, falling back to dev override if enabled:', authError);

      // In DEV with PRO override, don't block on auth
      if (hasProAccess(false)) {
        return NextResponse.json({
          tickers: [],
          access: { is_locked: false },
        });
      }

      return NextResponse.json(
        { error: 'NO_AUTH', message: 'Authentication required', access: { is_locked: true } },
        { status: 401 }
      );
    }

    // PRO gating similar to performance preview
    const [{ data: subStatus }, { data: profile }] = await Promise.all([
      supabase.from('subscription_status').select('tier').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_profile').select('subscription_tier').eq('user_id', user.id).maybeSingle(),
    ]);

    const tier = subStatus?.tier ?? profile?.subscription_tier ?? 'free';
    const isPro = tier === 'pro';
    const hasAccess = hasProAccess(isPro);

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'LOCKED', message: 'Upgrade to PRO to see performance universe', access: { is_locked: true } },
        { status: 403 }
      );
    }

    // 1) Load promoted swing universe from admin console
    const { data: universes, error: universeError } = await supabase
      .from('engine_universe')
      .select('universe_name, tickers')
      .eq('universe_name', 'performance_swing');

    if (universeError) {
      console.error('[performance/universe] failed to load universes', universeError);
      return NextResponse.json(
        { error: 'UNIVERSE_ERROR', message: 'Failed to load performance universe' },
        { status: 500 }
      );
    }

    // Build promoted ticker set. Admin console controls promotion/demotion here.
    const promotedSet = new Set<string>();
    for (const universe of universes || []) {
      const tickers = (universe.tickers as string[]) || [];
      for (const ticker of tickers) {
        if (!ticker) continue;
        promotedSet.add(String(ticker).toUpperCase());
      }
    }

    // 2) Aggregate LIVE stats from journal (live_trades) for ALL traded tickers (truth-first)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: liveTradesData, error: liveTradesError } = await supabase
      .from('live_trades')
      .select('ticker, realized_pnl_dollars')
      .eq('strategy', 'SWING')
      .gte('exit_timestamp', thirtyDaysAgo);

    if (liveTradesError) {
      console.error('[performance/universe] failed to load live swing trades', liveTradesError);
    }

    type LiveTickerStats = {
      ticker: string;
      trades: number;
      grossProfit: number;
      grossLoss: number;
      wins: number;
      losses: number;
      netPnl: number;
      pfInfinite: boolean;
    };

    const liveByTicker = new Map<string, LiveTickerStats>();

    for (const row of (liveTradesData || []) as { ticker: string; realized_pnl_dollars: number | null }[]) {
      const key = (row.ticker || '').toUpperCase();
      if (!key) continue;

      if (!liveByTicker.has(key)) {
        liveByTicker.set(key, {
          ticker: key,
          trades: 0,
          grossProfit: 0,
          grossLoss: 0,
          wins: 0,
          losses: 0,
          netPnl: 0,
          pfInfinite: false,
        });
      }

      const agg = liveByTicker.get(key)!;
      agg.trades += 1;
      const pnl = Number(row.realized_pnl_dollars ?? 0);
      agg.netPnl += pnl;
      if (pnl > 0) {
        agg.grossProfit += pnl;
        agg.wins += 1;
      }
      if (pnl < 0) {
        agg.grossLoss += -pnl;
        agg.losses += 1;
      }
    }

    // 3) Optionally, compute win-rate and profit factor per ticker
    const results = Array.from(liveByTicker.values()).map((live) => {
      let livePf: number | null = null;
      let livePfInfinite = false;
      if (live.trades > 0) {
        if (live.grossLoss > 0) {
          livePf = live.grossProfit / live.grossLoss;
        } else if (live.grossProfit > 0 && live.grossLoss === 0) {
          livePfInfinite = true;
        }
      }

      const totalDecisions = live.wins + live.losses;
      const liveWinRate = totalDecisions > 0 ? live.wins / totalDecisions : null;

      return {
        ticker: live.ticker,
        horizons: ['swing'],
        stats: {},
        backtest_expectancy: 0,
        live_trades: live.trades,
        live_profit_factor: livePf,
        live_pf_infinite: livePfInfinite,
        live_net_pnl: live.netPnl,
        live_win_rate: liveWinRate,
        is_promoted: promotedSet.has(live.ticker),
      };
    }).sort((a, b) => {
      // Sort by live_net_pnl descending, then trades
      if ((b.live_net_pnl ?? 0) !== (a.live_net_pnl ?? 0)) return (b.live_net_pnl ?? 0) - (a.live_net_pnl ?? 0);
      return (b.live_trades ?? 0) - (a.live_trades ?? 0);
    });

    return NextResponse.json({
      tickers: results,
      access: { is_locked: false },
    });
  } catch (error) {
    console.error('[performance/universe] unexpected error', error);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Failed to load performance universe' },
      { status: 500 }
    );
  }
}
