import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const ENGINE_KEY = 'SWING'
const ENGINE_VERSION = 'SWING_SHADOW_CTX_V1'
const RUN_MODE = 'SHADOW'

const supabase = supabaseAdmin

export async function GET() {
  try {
    // Portfolio snapshot for equity & starting_equity
    const { data: portfolio, error: portfolioError } = await supabase
      .from('engine_portfolios')
      .select('starting_equity, equity, allocated_notional')
      .eq('engine_key', ENGINE_KEY)
      .eq('engine_version', ENGINE_VERSION)
      .eq('run_mode', RUN_MODE)
      .maybeSingle()

    if (portfolioError) throw portfolioError

    // Closed trades for realized PnL and win rate
    const { data: trades, error: tradesError } = await supabase
      .from('engine_trades')
      .select('id, ticker, side, entry_price, exit_price, realized_pnl, realized_r, opened_at, closed_at')
      .eq('engine_key', ENGINE_KEY)
      .eq('engine_version', ENGINE_VERSION)
      .eq('run_mode', RUN_MODE)
      .order('closed_at', { ascending: false })
      .limit(500)

    if (tradesError) throw tradesError

    // Open positions enriched with marks from bars_1m
    const { data: openPositions, error: openError } = await supabase
      .from('engine_positions')
      .select(
        'id, ticker, side, qty, entry_price, stop_loss, take_profit, notional_at_entry, risk_dollars, opened_at, management_meta',
      )
      .eq('engine_key', ENGINE_KEY)
      .eq('engine_version', ENGINE_VERSION)
      .eq('run_mode', RUN_MODE)
      .eq('status', 'OPEN')

    if (openError) throw openError

    const enrichedOpen = await enrichOpenPositions(openPositions || [])

    const closedPositions = await loadRecentClosedPositions()

    const startingEquity = Number(portfolio?.starting_equity ?? 100000)
    const currentEquity = Number(portfolio?.equity ?? startingEquity)

    const closedTrades = (trades || []).filter((t) => t.closed_at)
    const winCount = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) > 0).length
    const lossCount = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) < 0).length
    const totalPnL = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0)
    const totalR = closedTrades.reduce((sum, t) => sum + Number(t.realized_r ?? 0), 0)

    const realizedPnL = Number(totalPnL.toFixed(2))
    const impliedUnrealized = currentEquity - startingEquity - realizedPnL
    const unrealizedPnL = Number(impliedUnrealized.toFixed(2))

    const metrics = {
      total_trades: closedTrades.length,
      trades_won: winCount,
      trades_lost: lossCount,
      win_rate_pct:
        closedTrades.length > 0 ? Number(((winCount / closedTrades.length) * 100).toFixed(2)) : 0,
      realized_pnl: realizedPnL,
      unrealized_pnl: unrealizedPnL,
      total_pnl: Number((realizedPnL + unrealizedPnL).toFixed(2)),
      current_equity: currentEquity,
      starting_equity: startingEquity,
    }

    const policy = await loadLatestMarketContextDecision()
    const liveEquitySummary = await loadLiveSwingEquitySummary()

    return NextResponse.json(
      {
        status: 'ok',
        metrics,
        open_positions: enrichedOpen,
        recent_closed_positions: closedPositions,
        trades: trades || [],
        policy,
        live_equity: liveEquitySummary,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[swing-context-shadow-metrics] Error:', error)
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

type EnginePositionRow = {
  id: string
  ticker: string | null
  side: 'LONG' | 'SHORT' | null
  qty: number | null
  entry_price: number | null
  stop_loss: number | null
  take_profit: number | null
  opened_at: string | null
  notional_at_entry: number | null
  risk_dollars: number | null
  management_meta: Record<string, unknown> | null
}

type EnrichedOpenPosition = {
  id: string
  ticker: string | null
  side: 'LONG' | 'SHORT' | null
  qty: number
  entry_price: number
  entry_time: string | null
  stop_loss: number | null
  take_profit: number | null
  notional_at_entry: number | null
  risk_dollars: number | null
  mark_price: number | null
  pnl_dollars: number | null
  pnl_pct: number | null
  management_meta: Record<string, unknown> | null
}

type ClosedPositionRow = {
  id: string
  ticker: string | null
  side: 'LONG' | 'SHORT' | null
  qty: number | null
  entry_price: number | null
  exit_price: number | null
  opened_at: string | null
  closed_at: string | null
  realized_pnl: number | null
  realized_r: number | null
  exit_reason: string | null
}

type MarketContextDecisionRow = {
  policy_version: string
  as_of: string
  trade_gate: string | null
  risk_scale: number | null
  max_positions_override: number | null
  regime: string | null
  notes: string[] | null
}

async function enrichOpenPositions(rows: EnginePositionRow[]): Promise<EnrichedOpenPosition[]> {
  if (!rows || rows.length === 0) return []

  const tickers = Array.from(
    new Set(
      rows
        .map((pos) => (pos.ticker || '').trim().toUpperCase())
        .filter((ticker) => ticker.length > 0),
    ),
  )

  let latestCloses: Record<string, number> = {}
  if (tickers.length > 0) {
    const { data, error } = await supabase
      .from('bars_1m')
      .select('symbol, ts, close')
      .in('symbol', tickers)
      .order('ts', { ascending: false })
      .limit(tickers.length * 50)

    if (error) {
      console.error('[swing-context-shadow-metrics] Failed to load bars_1m for marks', error.message ?? error)
    } else if (data) {
      latestCloses = {}
      for (const row of data as Array<{ symbol: string; ts: string; close: number }>) {
        const symbol = (row.symbol || '').toUpperCase()
        if (!symbol) continue
        if (latestCloses[symbol] !== undefined) continue
        const val = Number(row.close)
        if (!Number.isFinite(val)) continue
        latestCloses[symbol] = val
      }
    }
  }

  return rows.map((pos) => {
    const ticker = (pos.ticker || '').toUpperCase()
    const entryPrice = toNumber(pos.entry_price) ?? 0
    const qty = toNumber(pos.qty) ?? 0
    const markFromBars = ticker ? latestCloses[ticker] : undefined
    const meta = (pos.management_meta as Record<string, unknown> | null) ?? null

    let metaMarkPrice: number | null = null
    if (meta) {
      const rawMetaPrice =
        (meta as Record<string, unknown>).last_quote_price ??
        (meta as Record<string, unknown>).mark_price ??
        (meta as Record<string, unknown>).last_price ??
        null
      if (typeof rawMetaPrice === 'number' || typeof rawMetaPrice === 'string') {
        metaMarkPrice = toNumber(rawMetaPrice)
      }
    }

    const markPrice =
      markFromBars !== undefined && Number.isFinite(markFromBars)
        ? Number(markFromBars)
        : metaMarkPrice ?? entryPrice

    const direction = pos.side === 'SHORT' ? -1 : 1

    const pnlDollars =
      qty && entryPrice && markPrice != null
        ? Number(((markPrice - entryPrice) * qty * direction).toFixed(2))
        : null

    const pnlPct =
      entryPrice && markPrice != null
        ? Number((((markPrice - entryPrice) / entryPrice) * 100 * direction).toFixed(2))
        : null

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
      management_meta: meta,
    }
  })
}

async function loadRecentClosedPositions(): Promise<ClosedPositionRow[]> {
  const { data, error } = await supabase
    .from('engine_positions')
    .select(
      'id, ticker, side, qty, entry_price, exit_price, opened_at, closed_at, realized_pnl, realized_r, exit_reason',
    )
    .eq('engine_key', ENGINE_KEY)
    .eq('engine_version', ENGINE_VERSION)
    .eq('run_mode', RUN_MODE)
    .eq('status', 'CLOSED')
    .order('closed_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[swing-context-shadow-metrics] Failed to load recent closed positions', error.message ?? error)
    return []
  }

  return (data || []) as ClosedPositionRow[]
}

async function loadLatestMarketContextDecision(): Promise<MarketContextDecisionRow | null> {
  try {
    const { data, error } = await supabase
      .from('market_context_policy_decisions')
      .select('policy_version, as_of, trade_gate, risk_scale, max_positions_override, regime, notes')
      .eq('policy_version', 'CTX_V1_MINIMAL')
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[swing-context-shadow-metrics] Failed to load market context decision:', error.message ?? error)
      return null
    }

    return (data as MarketContextDecisionRow) ?? null
  } catch (err) {
    console.warn('[swing-context-shadow-metrics] Unexpected error loading market context decision:', err)
    return null
  }
}

async function loadLiveSwingEquitySummary(): Promise<{
  current_equity: number | null
  net_return_pct: number | null
} | null> {
  try {
    const { data: closedTrades, error: closedError } = await supabase
      .from('live_trades')
      .select('realized_pnl_dollars')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING')
      .not('exit_timestamp', 'is', null)

    if (closedError) throw closedError

    const { data: openPositions, error: openError } = await supabase
      .from('live_positions')
      .select('unrealized_pnl_dollars')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING')

    if (openError) throw openError

    const startingEquity = 100000
    const realized = (closedTrades || []).reduce(
      (sum, row) => sum + Number(row.realized_pnl_dollars ?? 0),
      0,
    )
    const unrealized = (openPositions || []).reduce(
      (sum, row) => sum + Number(row.unrealized_pnl_dollars ?? 0),
      0,
    )

    const currentEquity = startingEquity + realized + unrealized
    const netReturnPct = ((currentEquity - startingEquity) / startingEquity) * 100

    return {
      current_equity: Number(currentEquity.toFixed(2)),
      net_return_pct: Number(netReturnPct.toFixed(2)),
    }
  } catch (err) {
    console.warn('[swing-context-shadow-metrics] Failed to load live SWING equity summary:', err)
    return null
  }
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}