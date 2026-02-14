import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';
import { buildDailySeries, type EquitySnapshotRow } from '@/lib/performance/dailySeries';
import { INITIAL_EQUITY } from '@/lib/performance/metrics';

export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = 'GET,OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type, Supabase-Access-Token';

function applyCors(response: NextResponse, request: Request) {
  const origin = request.headers.get('origin') ?? '*';
  response.headers.set('Access-Control-Allow-Origin', origin || '*');
  if (origin) {
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  response.headers.set('Access-Control-Max-Age', '600');
  return response;
}

export async function OPTIONS(request: Request) {
  return applyCors(new NextResponse(null, { status: 204 }), request);
}

/**
 * GET /api/performance/summary
 * Returns LIVE TRADING model portfolio performance summary with equity curve
 * Pulls from live_trades and live_portfolio_state tables
 * PRO-only feature
 */
export async function GET(request: Request) {
  const corsJson = (data: any, status = 200) => applyCors(NextResponse.json(data, { status }), request);
  try {
    const url = new URL(request.url);
    const isPublicPreview = url.searchParams.get('public') === '1';

    const supabase = await createClient();

    // Public marketing preview bypasses subscription enforcement.
    if (!isPublicPreview) {
      try {
        const { requireActiveEntitlement } = await import("@/app/api/_lib/entitlement");
        await requireActiveEntitlement(request as any);
      } catch (resp: any) {
        if (resp instanceof Response) {
          return applyCors(resp as any, request);
        }
        return corsJson({ error: "subscription_required" }, 403);
      }
    }

    // Align with journal + admin: restrict to LIVE engine only (engine_key = 'SWING')
    // 1) Fetch all closed trades for LIVE SWING engine (realized P&L since inception)
    const { data: allTrades, error: tradesError } = await supabase
      .from('live_trades')
      .select('realized_pnl_dollars, realized_pnl_date, entry_timestamp, exit_timestamp, exit_price, entry_price, exit_reason, side')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING')
      .order('realized_pnl_date', { ascending: true, nullsFirst: false })
      .order('exit_timestamp', { ascending: true });

    if (tradesError) {
      console.error('[performance/summary] Error fetching trades:', tradesError);
      return corsJson({ error: 'Failed to fetch trades data' }, 500);
    }

    // 2) Fetch open positions for unrealized P&L (LIVE SWING engine only)
    const { data: openPositions, error: posError } = await supabase
      .from('live_positions')
      .select('unrealized_pnl_dollars')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING');

    if (posError) {
      console.error('[performance/summary] Error fetching open positions:', posError);
      return corsJson({ error: 'Failed to fetch open positions' }, 500);
    }

    const starting_equity = INITIAL_EQUITY; // Single $100K Active Signals portfolio
    const now = new Date();
    const firstTradeIso = allTrades?.[0]?.realized_pnl_date ?? allTrades?.[0]?.exit_timestamp;
    const startDate = firstTradeIso ? new Date(firstTradeIso) : new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(now);
    endDate.setUTCHours(23, 59, 59, 999);

    const { data: portfolioSnapshots, error: snapshotsError } = await supabase
      .from('live_portfolio_state')
      .select('equity_dollars, timestamp, ts')
      .eq('strategy', 'SWING')
      .order('timestamp', { ascending: true });

    if (snapshotsError) {
      console.error('[performance/summary] Error fetching portfolio snapshots:', snapshotsError);
    }

    const unrealizedFromPositions = (openPositions || []).reduce(
      (sum, p) => sum + (p.unrealized_pnl_dollars || 0),
      0,
    );

    const { order: dayOrder, map: dailyMap } = buildDailySeries({
      startDate,
      endDate,
      startingEquity: starting_equity,
      trades: (allTrades || []).map((t) => ({
        realized_pnl_date: t.realized_pnl_date ?? (t.exit_timestamp ? t.exit_timestamp.slice(0, 10) : null),
        realized_pnl_dollars: t.realized_pnl_dollars ?? 0,
      })),
      snapshots: (portfolioSnapshots as EquitySnapshotRow[]) || [],
    });

    const latestKey = dayOrder[dayOrder.length - 1];
    if (latestKey) {
      const latest = dailyMap.get(latestKey);
      if (latest) {
        latest.unrealized = unrealizedFromPositions;
        latest.equity = starting_equity + latest.cumulativeRealized + latest.unrealized;
        dailyMap.set(latestKey, latest);
      }
    }

    const equity_curve = dayOrder.map((key) => {
      const daily = dailyMap.get(key)!;
      return {
        date: `${key}T21:00:00Z`,
        equity: daily.equity,
      };
    });

    let peak = starting_equity;
    let max_drawdown_pct = 0;
    for (const point of equity_curve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = ((peak - point.equity) / peak) * 100;
      if (drawdown > max_drawdown_pct) {
        max_drawdown_pct = drawdown;
      }
    }

    const latestDaily = latestKey ? dailyMap.get(latestKey) : null;
    const current_equity = latestDaily?.equity ?? starting_equity;
    const total_return_pct = ((current_equity - starting_equity) / starting_equity) * 100;

    // Calculate trade statistics
    const cumulative_trades = allTrades?.length || 0;
    const cumulative_wins =
      allTrades?.filter(
        (t: any) => t.exit_reason === 'TP_HIT' || t.exit_reason === 'TRAILING_SL_HIT' || (t.realized_pnl_dollars ?? 0) > 0,
      ).length || 0;

    const win_rate_pct = cumulative_trades > 0 ? (cumulative_wins / cumulative_trades) * 100 : 0;

    // Profit factor: gross profits / gross losses (abs). Null if no losses.
    let grossProfit = 0;
    let grossLossAbs = 0;
    for (const t of allTrades ?? []) {
      const pnl = typeof (t as any).realized_pnl_dollars === 'number' ? (t as any).realized_pnl_dollars : 0;
      if (pnl > 0) grossProfit += pnl;
      else if (pnl < 0) grossLossAbs += Math.abs(pnl);
    }
    const profit_factor = grossLossAbs > 0 ? grossProfit / grossLossAbs : null;

    // Avg hold time in hours for closed trades (entry_timestamp -> exit_timestamp)
    let holdSumMs = 0;
    let holdCount = 0;
    for (const t of allTrades ?? []) {
      const entryTs = (t as any).entry_timestamp as string | null | undefined;
      const exitTs = (t as any).exit_timestamp as string | null | undefined;
      if (!entryTs || !exitTs) continue;
      const entryMs = new Date(entryTs).getTime();
      const exitMs = new Date(exitTs).getTime();
      if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs)) continue;
      const diff = exitMs - entryMs;
      if (diff <= 0) continue;
      holdSumMs += diff;
      holdCount += 1;
    }
    const avg_hold_hours = holdCount > 0 ? holdSumMs / holdCount / (1000 * 60 * 60) : null;

    // Find best and worst trades
    let best_trade_pct = null;
    let worst_trade_pct = null;
    
    if (allTrades && allTrades.length > 0) {
      for (const trade of allTrades) {
        const pnl_pct = ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100 * 
                        (trade.side === 'SHORT' ? -1 : 1);
        
        if (best_trade_pct === null || pnl_pct > best_trade_pct) {
          best_trade_pct = pnl_pct;
        }
        
        if (worst_trade_pct === null || pnl_pct < worst_trade_pct) {
          worst_trade_pct = pnl_pct;
        }
      }
    }


    return corsJson({
      starting_equity,
      current_equity,
      total_return_pct: Math.round(total_return_pct * 100) / 100,
      max_drawdown_pct: Math.round(max_drawdown_pct * 100) / 100,
      trades_count: cumulative_trades,
      win_rate_pct: Math.round(win_rate_pct * 100) / 100,
      profit_factor: typeof profit_factor === 'number' ? Math.round(profit_factor * 100) / 100 : null,
      avg_hold_hours: typeof avg_hold_hours === 'number' ? Math.round(avg_hold_hours * 10) / 10 : null,
      best_trade_pct: best_trade_pct !== null ? Math.round(best_trade_pct * 100) / 100 : null,
      worst_trade_pct: worst_trade_pct !== null ? Math.round(worst_trade_pct * 100) / 100 : null,
      equity_curve,
      access: { is_locked: false },
    });
  } catch (error) {
    console.error('[performance/summary] Unexpected error:', error);
    return corsJson({ error: 'Internal server error' }, 500);
  }
}
