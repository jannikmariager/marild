import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

const ENGINE_KEY = 'QUICK_PROFIT';
const ENGINE_VERSION = 'QUICK_PROFIT_V1';
const SOURCE_ENGINE_KEY = 'SCALP';
const SOURCE_ENGINE_VERSION = 'SCALP_V1_MICROEDGE';
const RUN_MODE = 'SHADOW';

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

type EnginePositionRow = {
  id: string;
  ticker: string | null;
  side: 'LONG' | 'SHORT' | null;
  qty: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  opened_at: string | null;
  status: 'OPEN' | 'CLOSED';
  closed_at: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl: number | null;
  realized_r: number | null;
  risk_dollars: number | null;
  notional_at_entry: number | null;
  be_activated_at: string | null;
  partial_taken: boolean | null;
  trail_active: boolean | null;
  trail_stop_price: number | null;
  trail_peak_pnl: number | null;
  management_meta: Record<string, unknown> | null;
};

function hasShadowData(result: Awaited<ReturnType<typeof fetchSourceData>>) {
  if (!result) return false;
  return result.trades.length > 0 || result.openPositions.length > 0;
}

const POSITION_COLUMNS = [
  'id',
  'ticker',
  'side',
  'qty',
  'entry_price',
  'stop_loss',
  'take_profit',
  'opened_at',
  'status',
  'closed_at',
  'exit_price',
  'exit_reason',
  'realized_pnl',
  'realized_r',
  'risk_dollars',
  'notional_at_entry',
  'be_activated_at',
  'partial_taken',
  'trail_active',
  'trail_stop_price',
  'trail_peak_pnl',
  'management_meta',
];

async function fetchSourceData(
  supabase: ReturnType<typeof getAdminSupabaseOrThrow>,
  source: { engine_key: string; engine_version: string }
) {
  const [portfolioRes, tradesRes, openPositionsRes, closedPositionsRes] = await Promise.all([
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
      .select(POSITION_COLUMNS.join(', '))
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .eq('status', 'OPEN'),
    supabase
      .from('engine_positions')
      .select(POSITION_COLUMNS.join(', '))
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .eq('status', 'CLOSED')
      .order('closed_at', { ascending: false })
      .limit(100),
  ]);

  if (portfolioRes.error) throw portfolioRes.error;
  if (tradesRes.error) throw tradesRes.error;
  if (openPositionsRes.error) throw openPositionsRes.error;
  if (closedPositionsRes.error) throw closedPositionsRes.error;

  return {
    portfolio: portfolioRes.data,
    trades: tradesRes.data || [],
    openPositions: ((openPositionsRes.data || []) as unknown) as EnginePositionRow[],
    closedPositions: ((closedPositionsRes.data || []) as unknown) as EnginePositionRow[],
  };
}

type FormattedOpenPosition = {
  id: string;
  ticker: string | null;
  side: 'LONG' | 'SHORT' | null;
  qty: number;
  entry_price: number;
  entry_time: string | null;
  stop_loss: number | null;
  take_profit: number | null;
  notional_at_entry: number | null;
  risk_dollars: number | null;
  mark_price: number | null;
  pnl_dollars: number | null;
  pnl_pct: number | null;
  be_activated_at: string | null;
  breakeven_active: boolean;
  partial_taken: boolean;
  trail_active: boolean;
  trail_stop_price: number | null;
  trail_peak_pnl: number | null;
  management_meta: Record<string, unknown> | null;
};

type FormattedClosedPosition = {
  id: string;
  ticker: string | null;
  side: 'LONG' | 'SHORT' | null;
  qty: number | null;
  entry_price: number | null;
  entry_time: string | null;
  exit_price: number | null;
  exit_time: string | null;
  realized_pnl: number | null;
  realized_r: number | null;
  pnl_pct: number | null;
  exit_reason: string | null;
  be_activated_at: string | null;
  breakeven_active: boolean;
  partial_taken: boolean;
  trail_active: boolean;
  trail_stop_price: number | null;
  trail_peak_pnl: number | null;
};

function directionMultiplier(side: 'LONG' | 'SHORT' | null) {
  return side === 'SHORT' ? -1 : 1;
}
function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function enrichOpenPositions(
  supabase: ReturnType<typeof getAdminSupabaseOrThrow>,
  positions: EnginePositionRow[]
): Promise<FormattedOpenPosition[]> {
  if (!positions || positions.length === 0) return [];

  const tickers = Array.from(
    new Set(
      positions
        .map((pos) => (pos.ticker || '').trim().toUpperCase())
        .filter((ticker) => ticker.length > 0),
    ),
  );

  // Prefer using our own bars_1m table for marks so admin UI is consistent with
  // the rest of the engine stack and does not depend on external APIs.
  let latestCloses: Record<string, number> = {};
  if (tickers.length > 0) {
    const { data, error } = await supabase
      .from('bars_1m')
      .select('symbol, ts, close')
      .in('symbol', tickers)
      .order('ts', { ascending: false })
      .limit(tickers.length * 50);

    if (error) {
      console.error('[quick-profit-metrics] Failed to load bars_1m for marks', error.message ?? error);
    } else if (data) {
      latestCloses = {};
      for (const row of data as Array<{ symbol: string; ts: string; close: number }>) {
        const symbol = (row.symbol || '').toUpperCase();
        if (!symbol) continue;
        if (latestCloses[symbol] !== undefined) continue; // already have latest due to ts DESC
        const val = Number(row.close);
        if (!Number.isFinite(val)) continue;
        latestCloses[symbol] = val;
      }
    }
  }

  return positions.map((pos) => {
    const ticker = (pos.ticker || '').toUpperCase();
    const entryPriceRaw = toNumber(pos.entry_price);
    const entryPrice = entryPriceRaw ?? 0;
    const qtyRaw = toNumber(pos.qty);
    const qty = qtyRaw ?? 0;
    const markFromBars = ticker ? latestCloses[ticker] : undefined;
    const meta = (pos.management_meta as Record<string, unknown> | null) ?? null;
    let metaMarkPrice: number | null = null;
    if (meta) {
      const rawMetaPrice =
        (meta as Record<string, unknown>).last_quote_price ??
        (meta as Record<string, unknown>).mark_price ??
        (meta as Record<string, unknown>).last_price ??
        null;
      if (typeof rawMetaPrice === 'number' || typeof rawMetaPrice === 'string') {
        metaMarkPrice = toNumber(rawMetaPrice);
      }
    }
    const markPrice =
      markFromBars !== undefined && Number.isFinite(markFromBars)
        ? Number(markFromBars)
        : metaMarkPrice ?? entryPrice;
    const direction = directionMultiplier(pos.side);
    const pnlDollars =
      qtyRaw !== null && entryPriceRaw !== null && markPrice !== null
        ? Number(((markPrice - entryPrice) * qty * direction).toFixed(2))
        : null;
    const pnlPct =
      entryPriceRaw !== null && markPrice !== null
        ? Number((((markPrice - entryPrice) / entryPrice) * 100 * direction).toFixed(2))
        : null;

    return {
      id: pos.id,
      ticker: pos.ticker,
      side: pos.side,
      qty,
      entry_price: entryPrice,
      entry_time: pos.opened_at,
      stop_loss: toNumber(pos.stop_loss),
      take_profit: toNumber(pos.take_profit),
      notional_at_entry: toNumber(pos.notional_at_entry),
      risk_dollars: toNumber(pos.risk_dollars),
      mark_price: markPrice ?? null,
      pnl_dollars: pnlDollars,
      pnl_pct: pnlPct,
      be_activated_at: pos.be_activated_at,
      breakeven_active: Boolean(pos.be_activated_at),
      partial_taken: Boolean(pos.partial_taken),
      trail_active: Boolean(pos.trail_active),
      trail_stop_price: toNumber(pos.trail_stop_price),
      trail_peak_pnl: toNumber(pos.trail_peak_pnl),
      management_meta: pos.management_meta ?? null,
    };
  });
}

function formatClosedPositions(positions: EnginePositionRow[]): FormattedClosedPosition[] {
  if (!positions || positions.length === 0) return [];
  return positions.map((pos) => {
    const entryPrice = toNumber(pos.entry_price);
    const exitPrice = toNumber(pos.exit_price);
    const direction = directionMultiplier(pos.side);

    const pnlPct =
      entryPrice !== null && exitPrice !== null
        ? Number((((exitPrice - entryPrice) / entryPrice) * 100 * direction).toFixed(2))
        : null;

    return {
      id: pos.id,
      ticker: pos.ticker,
      side: pos.side,
      qty: toNumber(pos.qty),
      entry_price: entryPrice,
      entry_time: pos.opened_at,
      exit_price: exitPrice,
      exit_time: pos.closed_at,
      realized_pnl: toNumber(pos.realized_pnl),
      realized_r: toNumber(pos.realized_r),
      pnl_pct: pnlPct,
      exit_reason: pos.exit_reason,
      be_activated_at: pos.be_activated_at,
      breakeven_active: Boolean(pos.be_activated_at),
      partial_taken: Boolean(pos.partial_taken),
      trail_active: Boolean(pos.trail_active),
      trail_stop_price: toNumber(pos.trail_stop_price),
      trail_peak_pnl: toNumber(pos.trail_peak_pnl),
    };
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  try {
    let sourceToUse = ENGINE_SOURCES[0];
    let data = await fetchSourceData(supabase, sourceToUse);

    if (!hasShadowData(data) && ENGINE_SOURCES.length > 1) {
      const fallbackSource = ENGINE_SOURCES[1];
      const fallbackData = await fetchSourceData(supabase, fallbackSource);
      if (hasShadowData(fallbackData)) {
        sourceToUse = fallbackSource;
        data = fallbackData;
      }
    }

    const { portfolio, trades, openPositions, closedPositions } = data as any;

    const closedTrades = ((trades as any[]) || []).filter((t: any) => t.closed_at);
    const winCount = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) > 0).length;
    const lossCount = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) < 0).length;
    const totalPnL = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
    const totalR = closedTrades.reduce((sum, t) => sum + Number(t.realized_r ?? 0), 0);

    const startingEquity = Number(portfolio?.starting_equity ?? 100000);
    const currentEquity = Number(portfolio?.equity ?? startingEquity);

    const realizedPnL = parseFloat(totalPnL.toFixed(2));
    const impliedUnrealized = currentEquity - startingEquity - realizedPnL;
    const unrealizedPnL = parseFloat(impliedUnrealized.toFixed(2));
    const totalPnl = parseFloat((realizedPnL + unrealizedPnL).toFixed(2));
    const openCount = openPositions.length;

    const metrics = {
      total_trades: closedTrades.length,
      trades_won: winCount,
      trades_lost: lossCount,
      win_rate_pct: closedTrades.length > 0 ? parseFloat(((winCount / closedTrades.length) * 100).toFixed(2)) : 0,
      realized_pnl: realizedPnL,
      unrealized_pnl: unrealizedPnL,
      total_pnl: totalPnl,
      avg_trade_r: closedTrades.length > 0 ? parseFloat((totalR / closedTrades.length).toFixed(4)) : 0,
      open_positions: openCount,
      max_positions: numberFromEnv('QUICK_PROFIT_MAX_POSITIONS', 10),
      current_equity: currentEquity,
      starting_equity: startingEquity,
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

    const formattedOpenPositions = await enrichOpenPositions(supabase, openPositions as EnginePositionRow[]);
    const formattedClosedPositions = formatClosedPositions(closedPositions as EnginePositionRow[]);

    return NextResponse.json(
      {
        status: 'ok',
        metrics,
        trades: formattedTrades,
        open_positions: formattedOpenPositions,
        recent_closed_positions: formattedClosedPositions,
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
