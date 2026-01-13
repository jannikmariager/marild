import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { computePortfolioMetrics, type ClosedTrade, INITIAL_EQUITY } from '@/lib/performance/metrics';
import { calculateTradingDays } from '@/lib/performance/tradingDays';
import { calculateExposureAndRisk } from '@/lib/performance/riskSummary';
import { createClient as createServerClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

export async function GET(request: NextRequest) {
  try {
    const authClient = await createServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    const supabase = createServiceClient(supabaseUrl, supabaseServiceKey);
    const { searchParams } = new URL(request.url);
    const strategy = normalizeToActiveStrategy(searchParams.get('strategy'));

    // Entitlement: DEV override or PRO tier from users.subscription_tier
    let isEntitled = hasProAccess(false);

    if (user && !isEntitled) {
      const { data: profile } = await authClient
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', user.id)
        .maybeSingle();

      const hasPaid = profile?.subscription_tier === 'pro';
      isEntitled = hasProAccess(!!hasPaid);
    }

    if (!user && !isEntitled) {
      return NextResponse.json(
        { error: 'Unauthorized', access: { is_locked: true } },
        { status: 401 },
      );
    }

    // 1. Build equity curve from live_trades for real-time updates
    // Get ALL closed trades to build cumulative equity curve
    const { data: allClosedTrades, error: equityError } = await supabase
      .from('live_trades')
      .select('exit_timestamp, realized_pnl_dollars')
      .eq('strategy', strategy)
      .not('exit_timestamp', 'is', null)
      .order('exit_timestamp', { ascending: true});

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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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

    const closedTrades: ClosedTrade[] = (allTrades || []).map((t) => ({
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
    const todayPnl = todayTrades?.reduce((sum, t) => sum + t.realized_pnl_dollars, 0) || 0;
    const todayTrades_count = todayTrades?.length || 0;

    // Build equity curve from cumulative realized P&L
    const starting_equity = INITIAL_EQUITY;
    const equityCurvePoints: Array<{
      timestamp: string;
      equity: number;
      cash: number;
      unrealized_pnl: number;
      open_positions_count: number;
    }> = [];
    
    let cumulativeRealizedPnl = 0;
    
    // Add starting point
    if (allClosedTrades && allClosedTrades.length > 0) {
      const firstTradeDate = new Date(allClosedTrades[0].exit_timestamp);
      firstTradeDate.setHours(0, 0, 0, 0);
      equityCurvePoints.push({
        timestamp: firstTradeDate.toISOString(),
        equity: starting_equity,
        cash: starting_equity,
        unrealized_pnl: 0,
        open_positions_count: 0,
      });
    }
    
    // Add point for each closed trade
    for (const trade of allClosedTrades || []) {
      cumulativeRealizedPnl += (trade.realized_pnl_dollars || 0);
      equityCurvePoints.push({
        timestamp: trade.exit_timestamp,
        equity: starting_equity + cumulativeRealizedPnl,
        cash: starting_equity + cumulativeRealizedPnl - unrealizedPnlDollars,
        unrealized_pnl: unrealizedPnlDollars,
        open_positions_count: openPositions?.length || 0,
      });
    }
    
    // Add current point with unrealized P&L
    if (equityCurvePoints.length > 0) {
      equityCurvePoints.push({
        timestamp: new Date().toISOString(),
        equity: starting_equity + cumulativeRealizedPnl + unrealizedPnlDollars,
        cash: starting_equity + cumulativeRealizedPnl,
        unrealized_pnl: unrealizedPnlDollars,
        open_positions_count: openPositions?.length || 0,
      });
    }

    // Calculate trading days from equity curve points
    const { tradingDays, periodStart, periodEnd } = calculateTradingDays(
      equityCurvePoints.map((p) => ({ timestamp: p.timestamp })),
      {
        startDateIso: equityCurvePoints.length > 0 ? equityCurvePoints[0].timestamp : undefined,
        timeZone: 'America/New_York',
      },
    );

    // Latest equity state from the curve
    const currentEquity = equityCurvePoints.length > 0 
      ? equityCurvePoints[equityCurvePoints.length - 1].equity 
      : initialEquity;
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
