import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { buildDailySeries, type EquitySnapshotRow } from '@/lib/performance/dailySeries';
import { computePortfolioMetrics, type ClosedTrade, INITIAL_EQUITY } from '@/lib/performance/metrics';
import { calculateExposureAndRisk } from '@/lib/performance/riskSummary';
import { calculateTradingDays } from '@/lib/performance/tradingDays';
import { createClient as createServerClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';


function normalizeToActiveStrategy(raw?: string | null): 'DAYTRADE' | 'SWING' {
  const v = (raw || '').toUpperCase();
  if (v === 'DAYTRADE' || v === 'DAY') {
    // Daytrader is archived – normalize to SWING but do not throw.
    console.warn(`[live-portfolio] Received disabled strategy=${v}, normalizing to SWING`);
    return 'SWING';
  }
  if (v === 'SWING') return 'SWING';
  // Unknown / missing → SWING (active engine)
  return 'SWING';
}

const getBearerToken = (request: NextRequest): string | null => {
  const raw = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export async function GET(request: NextRequest) {
  const now = new Date();
  try {
    // Hard gate: require an active subscription.
    try {
      const { requireActiveEntitlement } = await import('@/app/api/_lib/entitlement');
      await requireActiveEntitlement(request);
    } catch (resp: any) {
      if (resp instanceof Response) {
        return resp as any;
      }
      throw resp;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const authClient = await createServerClient();
    const {
      data: { user: cookieUser },
    } = await authClient.auth.getUser();

    // Fallback: accept Bearer token auth (Vite frontend uses access_token, not Next cookie sessions).
    let bearerUser: { id: string; email?: string | null } | null = null;
    if (!cookieUser) {
      const token = getBearerToken(request);
      if (token) {
        try {
          const supabaseAdmin = createServiceClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false },
          });
          const {
            data: { user },
          } = await supabaseAdmin.auth.getUser(token);
          if (user) {
            bearerUser = { id: user.id, email: user.email };
          }
        } catch (e) {
          console.warn('[live-portfolio] bearer auth failed', e);
        }
      }
    }

    const user = cookieUser ?? (bearerUser as any);

    const supabase = createServiceClient(supabaseUrl, supabaseServiceKey);
    const { searchParams } = new URL(request.url);
    const strategy = normalizeToActiveStrategy(searchParams.get('strategy'));

    // Entitlement: DEV override or PRO tier from users.subscription_tier
    let isEntitled = hasProAccess(false);

    if (user && !isEntitled) {
      // Prefer cookie-backed client when available; otherwise query via service client.
      const { data: profile } = cookieUser
        ? await authClient.from('user_profile').select('subscription_tier').eq('user_id', user.id).maybeSingle()
        : await supabase.from('user_profile').select('subscription_tier').eq('user_id', user.id).maybeSingle();

      const hasPaid = profile?.subscription_tier === 'pro';
      isEntitled = hasProAccess(!!hasPaid);
    }

    if (!user && !isEntitled) {
      return NextResponse.json(
        { error: 'Unauthorized', access: { is_locked: true } },
        { status: 401 },
      );
    }

    const { data: portfolioSnapshots, error: portfolioSnapshotsError } = await supabase
      .from('live_portfolio_state')
      .select('equity_dollars, timestamp, ts')
      .eq('strategy', strategy)
      .order('timestamp', { ascending: true });

    if (portfolioSnapshotsError) {
      console.error('Error fetching live_portfolio_state snapshots:', portfolioSnapshotsError);
    }

    // 1. Build equity curve from live_trades for real-time updates
    // Get ALL closed trades to build cumulative equity curve
    const { data: allClosedTrades, error: equityError } = await supabase
      .from('live_trades')
      .select(
        'entry_price, exit_price, realized_pnl_dollars, notional_at_entry, size_shares, exit_timestamp, realized_pnl_date',
      )
      .eq('strategy', strategy)
      .not('exit_timestamp', 'is', null)
      .order('exit_timestamp', { ascending: true });

    if (equityError) {
      console.error('Error fetching trades for equity curve:', equityError);
      return NextResponse.json({ error: equityError.message }, { status: 500 });
    }

    // 2. Get open positions with signal data
    const { data: openPositions, error: positionsError } = await supabase
      .from('live_positions')
      .select(`
        *,
        signal:ai_signals!signal_id (
          entry_price,
          stop_loss,
          take_profit_1,
          take_profit_2,
          created_at
        )
      `)
      .eq('strategy', strategy)
      .order('entry_timestamp', { ascending: false });

    if (positionsError) {
      console.error('Error fetching open positions:', positionsError);
      return NextResponse.json({ error: positionsError.message }, { status: 500 });
    }

    // 3. Get closed trades (today)
    const todayKey = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);

    const { data: todayTrades, error: tradesError } = await supabase
      .from('live_trades')
      .select('*')
      .eq('strategy', strategy)
      .gte('exit_timestamp', todayStart.toISOString())
      .order('exit_timestamp', { ascending: false });

    if (tradesError) {
      console.error('Error fetching today trades:', tradesError);
      return NextResponse.json({ error: tradesError.message }, { status: 500 });
    }

    // 4. Get all closed trades (last 30 days for stats)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    thirtyDaysAgo.setUTCHours(0, 0, 0, 0);

    const { data: allTrades, error: allTradesError } = await supabase
      .from('live_trades')
      .select('*')
      .eq('strategy', strategy)
      .gte('exit_timestamp', thirtyDaysAgo.toISOString())
      .order('exit_timestamp', { ascending: false });

    if (allTradesError) {
      console.error('Error fetching all trades:', allTradesError);
      return NextResponse.json({ error: allTradesError.message }, { status: 500 });
    }

    // 5. Calculate unrealized P&L and stats
    const unrealizedPnlDollars = (openPositions || []).reduce(
      (sum, pos) => sum + (pos.unrealized_pnl_dollars || 0),
      0,
    );

    const riskSummary = calculateExposureAndRisk(openPositions, {
      startingBalance: INITIAL_EQUITY,
    });

    const closedTrades: ClosedTrade[] = (allClosedTrades || []).map((t) => ({
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      realized_pnl_dollars: t.realized_pnl_dollars,
      capital_at_entry: typeof t.notional_at_entry === 'number'
        ? Math.abs(t.notional_at_entry)
        : (typeof t.entry_price === 'number' && typeof t.size_shares === 'number'
            ? Math.abs(t.entry_price * t.size_shares)
            : null),
      exit_timestamp: t.exit_timestamp,
    }));

    const metrics = computePortfolioMetrics(closedTrades, {
      unrealizedPnlDollars,
    });

    const initialEquity = INITIAL_EQUITY;

    // Today's stats
    const todayPnl = (allClosedTrades || []).reduce((sum, t) => {
      const day = t.realized_pnl_date ?? (t.exit_timestamp ? t.exit_timestamp.slice(0, 10) : null);
      if (day === todayKey) {
        return sum + (t.realized_pnl_dollars || 0);
      }
      return sum;
    }, 0);
    const todayTrades_count = (allClosedTrades || []).filter((t) => {
      const day = t.realized_pnl_date ?? (t.exit_timestamp ? t.exit_timestamp.slice(0, 10) : null);
      return day === todayKey;
    }).length;

    // Build equity curve from cumulative realized P&L
    const starting_equity = INITIAL_EQUITY;
    const firstTradeDateIso = allClosedTrades?.[0]?.realized_pnl_date ?? allClosedTrades?.[0]?.exit_timestamp;
    const dailySeriesStart = firstTradeDateIso ? new Date(firstTradeDateIso) : new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
    dailySeriesStart.setUTCHours(0, 0, 0, 0);

    const { order: equityDayOrder, map: equityDayMap } = buildDailySeries({
      startDate: dailySeriesStart,
      endDate: new Date(now),
      startingEquity: starting_equity,
      trades: (allClosedTrades || []).map((t) => ({
        realized_pnl_date: t.realized_pnl_date ?? (t.exit_timestamp ? t.exit_timestamp.slice(0, 10) : null),
        realized_pnl_dollars: t.realized_pnl_dollars ?? 0,
      })),
      snapshots: (portfolioSnapshots as EquitySnapshotRow[]) || [],
    });

    const lastEquityKey = equityDayOrder[equityDayOrder.length - 1];
    if (lastEquityKey) {
      const latest = equityDayMap.get(lastEquityKey);
      if (latest) {
        latest.unrealized = unrealizedPnlDollars;
        latest.equity = starting_equity + latest.cumulativeRealized + latest.unrealized;
        equityDayMap.set(lastEquityKey, latest);
      }
    }

    const equityCurvePoints = equityDayOrder.map((key) => {
      const daily = equityDayMap.get(key)!;
      return {
        timestamp: `${key}T21:00:00Z`,
        equity: daily.equity,
        cash: daily.equity - daily.unrealized,
        unrealized_pnl: daily.unrealized,
        open_positions_count: key === lastEquityKey ? (openPositions?.length || 0) : 0,
      };
    });

    // Calculate trading days from equity curve points
    const { tradingDays, periodStart, periodEnd } = calculateTradingDays(
      equityCurvePoints.map((p) => ({ timestamp: p.timestamp })),
      {
        startDateIso: equityCurvePoints.length > 0 ? equityCurvePoints[0].timestamp : undefined,
        timeZone: 'America/New_York',
      },
    );

    // Latest equity state from the curve
    const cashAvailable = equityCurvePoints.length > 0
      ? equityCurvePoints[equityCurvePoints.length - 1].cash
      : initialEquity;

    const riskSummaryPayload = isEntitled
      ? {
          total_market_exposure: riskSummary.totalMarketExposure,
          risk_at_stop: riskSummary.riskAtStop,
          risk_at_stop_pct: riskSummary.riskAtStopPct,
        }
      : null;

    const payload = {
      strategy,
      equity_curve: equityCurvePoints,
      open_positions: (openPositions || []).map(pos => ({
        ticker: pos.ticker,
        side: pos.side || 'LONG',
        entry_timestamp: pos.entry_timestamp,
        entry_price: pos.entry_price,
        current_price: pos.current_price,
        size_shares: pos.size_shares,
        notional_at_entry: pos.notional_at_entry,
        stop_loss: pos.stop_loss,
        take_profit: pos.take_profit,
        unrealized_pnl: pos.unrealized_pnl_dollars,
        unrealized_pnl_R: pos.unrealized_pnl_R,
        risk_dollars: pos.risk_dollars,
        // Signal data for Risk-Reward Rail
        signal_entry_price: pos.signal?.entry_price,
        signal_stop_loss: pos.signal?.stop_loss,
        signal_tp1: pos.signal?.take_profit_1,
        signal_tp2: pos.signal?.take_profit_2,
        signal_created_at: pos.signal?.created_at,
      })),
      today_trades: (todayTrades || []).map(trade => ({
        ticker: trade.ticker,
        side: trade.side || 'LONG',
        entry_timestamp: trade.entry_timestamp,
        entry_price: trade.entry_price,
        exit_timestamp: trade.exit_timestamp,
        exit_price: trade.exit_price,
        exit_reason: trade.exit_reason,
        size_shares: trade.size_shares,
        realized_pnl: trade.realized_pnl_dollars,
        realized_pnl_R: trade.realized_pnl_R,
      })),
      // Expose recent closed trades so the client can compute timeframe-filtered metrics
      // (visualization only; calculations remain equity/trade-derived).
      recent_trades: (allTrades || []).map(trade => ({
        ticker: trade.ticker,
        side: trade.side || 'LONG',
        entry_timestamp: trade.entry_timestamp,
        exit_timestamp: trade.exit_timestamp,
        exit_reason: trade.exit_reason,
        realized_pnl: trade.realized_pnl_dollars,
      })),
      stats: {
        current_equity: metrics.currentEquity,
        total_pnl: metrics.realizedPnl,
        total_pnl_pct: metrics.realizedPnlPct,
        win_rate_closed: metrics.winRateClosedPct,
        avg_trade_return_pct: metrics.avgTradeReturnPct,
        profit_factor: metrics.profitFactor,
        total_trades: metrics.totalTrades,
        today_pnl: todayPnl,
        today_trades: todayTrades_count,
        open_positions_count: openPositions?.length || 0,
        cash_available: cashAvailable,
        trading_days: tradingDays,
        period_start: periodStart,
        period_end: periodEnd,
      },
      risk_summary: riskSummaryPayload,
      // Execution metadata to make timeframe explicit for all consumers
      execution_timeframe: '1H',
      execution_model: '1H-only',
      access: { is_locked: !isEntitled },
    };

    if (!isEntitled) {
      payload.open_positions = [];
      payload.today_trades = [];
      payload.recent_trades = [];
    }


    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error('Live portfolio API error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
