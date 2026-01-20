import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ENGINE_KEY = 'QUICK_PROFIT';
const ENGINE_VERSION = 'QUICK_PROFIT_V1';
const SOURCE_ENGINE_KEY = 'SCALP';
const SOURCE_ENGINE_VERSION = 'SCALP_V1_MICROEDGE';
const RUN_MODE = 'SHADOW';

const supabase = supabaseAdmin;
const ENGINE_SOURCES = [
  { engine_key: ENGINE_KEY, engine_version: ENGINE_VERSION },
  { engine_key: SOURCE_ENGINE_KEY, engine_version: SOURCE_ENGINE_VERSION },
];

type EngineTradeRow = {
  id: string;
  ticker: string | null;
  side: string | null;
  entry_price: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  realized_r: number | null;
  opened_at: string | null;
  closed_at: string | null;
};

function hasShadowData(result: Awaited<ReturnType<typeof fetchSourceData>>) {
  if (!result) return false;
  return Boolean(result.portfolio) || result.trades.length > 0 || result.openPositions.length > 0;
}

async function fetchSourceData(source: { engine_key: string; engine_version: string }) {
  const [portfolioRes, tradesRes, positionsRes] = await Promise.all([
    supabase
      .from('engine_portfolios')
      .select('equity, starting_equity, allocated_notional')
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .maybeSingle(),
    supabase
      .from('engine_trades')
      .select('id, ticker, side, entry_price, exit_price, realized_pnl, realized_r, opened_at, closed_at')
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .order('opened_at', { ascending: false })
      .limit(500),
    supabase
      .from('engine_positions')
      .select('id, unrealized_pnl')
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .eq('status', 'OPEN'),
  ]);

  if (portfolioRes.error) throw portfolioRes.error;
  if (tradesRes.error) throw tradesRes.error;
  if (positionsRes.error) throw positionsRes.error;

  return {
    portfolio: portfolioRes.data,
    trades: tradesRes.data || [],
    openPositions: positionsRes.data || [],
  };
}

export async function GET() {
  try {
    let sourceToUse = ENGINE_SOURCES[0];
    let data = await fetchSourceData(sourceToUse);

    if (!hasShadowData(data) && ENGINE_SOURCES.length > 1) {
      const fallbackSource = ENGINE_SOURCES[1];
      const fallbackData = await fetchSourceData(fallbackSource);
      if (hasShadowData(fallbackData)) {
        sourceToUse = fallbackSource;
        data = fallbackData;
      }
    }

    const { portfolio, trades, openPositions } = data;

    const closedTrades = (trades || []).filter((t) => t.closed_at);
    const winCount = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) > 0).length;
    const lossCount = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) < 0).length;
    const totalPnL = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
    const totalR = closedTrades.reduce((sum, t) => sum + Number(t.realized_r ?? 0), 0);

    const unrealizedPnL = (openPositions || []).reduce(
      (sum, pos) => sum + Number(pos.unrealized_pnl ?? 0),
      0,
    );

    const metrics = {
      total_trades: closedTrades.length,
      trades_won: winCount,
      trades_lost: lossCount,
      win_rate_pct: closedTrades.length > 0 ? parseFloat(((winCount / closedTrades.length) * 100).toFixed(2)) : 0,
      realized_pnl: parseFloat(totalPnL.toFixed(2)),
      unrealized_pnl: parseFloat(unrealizedPnL.toFixed(2)),
      total_pnl: parseFloat((totalPnL + unrealizedPnL).toFixed(2)),
      avg_trade_r: closedTrades.length > 0 ? parseFloat((totalR / closedTrades.length).toFixed(4)) : 0,
      open_positions: (openPositions || []).length,
      max_positions: numberFromEnv('QUICK_PROFIT_MAX_POSITIONS', 10),
      current_equity: Number(portfolio?.equity ?? 100000),
      starting_equity: Number(portfolio?.starting_equity ?? 100000),
    };

    const formattedTrades = (trades || []).map((t: EngineTradeRow) => ({
      id: t.id,
      ticker: t.ticker,
      entry_price: t.entry_price ? Number(t.entry_price) : null,
      exit_price: t.exit_price ? Number(t.exit_price) : null,
      entry_time: t.opened_at,
      exit_time: t.closed_at,
      side: t.side,
      pnl_dollars:
        t.realized_pnl !== null && t.realized_pnl !== undefined ? Number(t.realized_pnl.toFixed(2)) : null,
      pnl_r: t.realized_r !== null && t.realized_r !== undefined ? Number(t.realized_r.toFixed(2)) : null,
      status: t.closed_at ? 'CLOSED' : 'OPEN',
    }));

    return NextResponse.json(
      {
        status: 'ok',
        metrics,
        trades: formattedTrades,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[quick-profit-metrics] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

function numberFromEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
