import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
// GET /api/performance/journal?strategy=SWING&days=90
// Read-only trading journal data grouped by exit date
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const strategy = searchParams.get('strategy') || 'SWING'; // or DAYTRADE
    const days = parseInt(searchParams.get('days') || '90', 10);

    const since = new Date();
    since.setDate(since.getDate() - days);

    // 1) Fetch executed trades in the lookback window (for calendar/day view)
    const engineKeyMap: Record<string, string> = {
      SWING: 'SWING',
      DAYTRADE: 'DAYTRADE',
    };
    const engineKey = engineKeyMap[strategy.toUpperCase()] ?? 'SWING';

    const { data: activeEngines, error: activeError } = await serviceSupabase
      .from('engine_versions')
      .select('engine_version')
      .eq('engine_key', engineKey)
      .eq('run_mode', 'PRIMARY')
      .eq('is_enabled', true)
      .is('stopped_at', null);

    if (activeError) {
      console.error('[performance/journal] Error fetching active engine versions:', activeError);
    }

    const activeEngineVersions = (activeEngines || []).map((row) => row.engine_version);
    if (engineKey === 'SWING') {
      activeEngineVersions.push('BASELINE');
    }
    const engineVersionFilter = activeEngineVersions.filter(Boolean);
    const engineVersionSet = new Set(engineVersionFilter);

    const shouldFilterByEngine = engineVersionSet.size > 0;

    const { data: trades, error } = await supabase
      .from('live_trades')
      .select(
        [
          'ticker',
          'strategy',
          'side',
          'entry_timestamp',
          'entry_price',
          'exit_timestamp',
          'exit_price',
          'size_shares',
          'realized_pnl_dollars',
          'realized_pnl_r',
          'exit_reason',
          'engine_version',
        ].join(', '),
      )
      .eq('strategy', strategy)
      .gte('exit_timestamp', since.toISOString())
      .order('exit_timestamp', { ascending: true });

    if (error) {
      console.error('[performance/journal] Error fetching trades:', error);
      return NextResponse.json({ error: 'Failed to load journal data' }, { status: 500 });
    }

    const safeTrades = (trades as any[]) || [];
    const filteredTrades = shouldFilterByEngine
      ? safeTrades.filter((t) => engineVersionSet.has(t.engine_version))
      : safeTrades;

    // 2) Compute since-inception totals to match the Live Trading card logic
    // (current equity = $100K + realized since inception + current unrealized)
    const { data: allClosedTrades, error: allClosedError } = await supabase
      .from('live_trades')
      .select('realized_pnl_dollars, engine_version')
      .eq('strategy', strategy)
      .not('exit_timestamp', 'is', null);

    if (allClosedError) {
      console.error('[performance/journal] Error fetching all closed trades:', allClosedError);
      return NextResponse.json({ error: 'Failed to load journal totals' }, { status: 500 });
    }

    const { data: openPositions, error: openPosError } = await supabase
      .from('live_positions')
      .select('unrealized_pnl_dollars, engine_version')
      .eq('strategy', strategy);

    if (openPosError) {
      console.error('[performance/journal] Error fetching open positions:', openPosError);
      return NextResponse.json({ error: 'Failed to load journal totals' }, { status: 500 });
    }
    const realizedPnl = ((allClosedTrades as any[]) || []).reduce(
      (sum, t) => sum + Number(t.realized_pnl_dollars ?? 0),
      0,
    );

    const unrealizedPnl = ((openPositions as any[]) || []).reduce(
      (sum, p) => sum + Number(p.unrealized_pnl_dollars ?? 0),
      0,
    );

    const sinceInceptionTotalPnl = realizedPnl + unrealizedPnl;
    const startingEquity = 100000;
    const currentEquity = startingEquity + sinceInceptionTotalPnl;

    type DayKey = string; // YYYY-MM-DD

    const daySummaries: Record<DayKey, {
      date: string;
      strategy: string;
      total_pnl: number;
      trades_count: number;
      winners: number;
      losers: number;
      flats: number;
    }> = {};

    const tradesByDay: Record<DayKey, any[]> = {};

    for (const t of filteredTrades) {
      const exitTs = t.exit_timestamp ?? t.entry_timestamp;
      if (!exitTs) continue;

      const exitDate = new Date(exitTs);
      // Group by UTC calendar date for now (can be adjusted to ET later)
      const key = exitDate.toISOString().slice(0, 10); // YYYY-MM-DD

      if (!daySummaries[key]) {
        daySummaries[key] = {
          date: key,
          strategy: t.strategy,
          total_pnl: 0,
          trades_count: 0,
          winners: 0,
          losers: 0,
          flats: 0,
        };
      }

      const realized = Number(t.realized_pnl_dollars ?? 0);

      const summary = daySummaries[key];
      summary.total_pnl += realized;
      summary.trades_count += 1;
      if (realized > 0) summary.winners += 1;
      else if (realized < 0) summary.losers += 1;
      else summary.flats += 1;

      if (!tradesByDay[key]) tradesByDay[key] = [];
      tradesByDay[key].push({
        ticker: t.ticker,
        strategy: t.strategy,
        side: t.side || 'LONG',
        entry_timestamp: t.entry_timestamp,
        entry_price: t.entry_price,
        exit_timestamp: t.exit_timestamp,
        exit_price: t.exit_price,
        size_shares: t.size_shares,
        realized_pnl_dollars: realized,
        realized_pnl_r: t.realized_pnl_r,
        exit_reason: t.exit_reason,
        is_optimization_exit:
          t.exit_reason === 'CAPITAL_RECYCLE_LOW_MOMENTUM' ||
          t.exit_reason === 'SLOT_RELEASE_REPLACEMENT',
      });
    }

    const daysList = Object.values(daySummaries).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      strategy,
      days: daysList,
      tradesByDay,
      totals: {
        starting_equity: startingEquity,
        current_equity: currentEquity,
        since_inception_realized_pnl: realizedPnl,
        current_unrealized_pnl: unrealizedPnl,
        since_inception_total_pnl: sinceInceptionTotalPnl,
      },
      meta: {
        lookback_days: days,
        total_trading_days: daysList.length,
        total_trades: filteredTrades.length,
      },
    });
  } catch (error) {
    console.error('[performance/journal] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
