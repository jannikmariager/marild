import { DateTime } from 'luxon'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { INITIAL_EQUITY } from '@/lib/performance/metrics'

export const REPORT_TZ = 'America/New_York'

export type WeeklyReportTradeOutcome = {
  take_profit: number
  stop_loss: number
  trailing_stop: number
  other: number
}

export type WeeklyReportTopSymbol = {
  symbol: string
  trades: number
  net_pnl_usd: number
}

export type WeeklyReportLargestTrade = {
  symbol: string | null
  pnl_usd: number | null
  return_pct: number | null
  closed_at: string | null
}

export type WeeklyReportSelectedTrade = {
  date: string // YYYY-MM-DD (NY)
  symbol: string
  dir: 'LONG' | 'SHORT'
  entry: number | null
  exit: number | null
  return_pct: number | null
  pnl_usd: number | null
  status: string | null
  closed_at: string | null
  trade_id: string
}

export type WeeklyExecutionMetrics = {
  week_start: string // YYYY-MM-DD (NY)
  week_end: string // YYYY-MM-DD (NY)
  week_label: string

  equity_at_week_start: number
  equity_at_week_end: number
  realized_before_week: number

  closed_trades: number
  winners_count: number
  losers_count: number
  win_rate_pct: number

  net_pnl_usd: number
  net_return_pct: number

  profit_factor: number
  pf_note?: string

  avg_hold_hours: number

  max_drawdown_pct: number
  drawdown_method: 'closed_trade_equity_path'

  trade_outcomes: WeeklyReportTradeOutcome
  top_symbols: WeeklyReportTopSymbol[]
  // Largest win/loss are by realized_pnl_dollars (USD) among closed trades in the week, not by % return.
  largest_win: WeeklyReportLargestTrade
  largest_loss: WeeklyReportLargestTrade

  // Convenience scalar copies of key dollar metrics for fast rendering.
  largest_win_usd: number
  largest_loss_usd: number

  selected_trades: WeeklyReportSelectedTrade[]
}

type LiveTradeRow = {
  id: string
  ticker: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  entry_timestamp: string | null
  exit_timestamp: string | null
  exit_reason: string | null
  realized_pnl_dollars: number | null
}

const nyDayKey = (iso: string): string => {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(REPORT_TZ)
  return dt.toFormat('yyyy-LL-dd')
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const computeReturnPct = (t: Pick<LiveTradeRow, 'entry_price' | 'exit_price' | 'side'>): number | null => {
  const entry = t.entry_price
  const exit = t.exit_price
  if (!isFiniteNum(entry) || entry <= 0) return null
  if (!isFiniteNum(exit)) return null
  const side = (t.side ?? 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
  const raw = ((exit - entry) / entry) * 100
  return side === 'SHORT' ? -raw : raw
}

const clamp2 = (n: number): number => Math.round(n * 100) / 100
const clamp1 = (n: number): number => Math.round(n * 10) / 10

export function getNyWeekLabel(weekStartNyKey: string, weekEndNyKey: string): string {
  const start = DateTime.fromISO(weekStartNyKey, { zone: REPORT_TZ })
  const end = DateTime.fromISO(weekEndNyKey, { zone: REPORT_TZ })
  // Example: Week of Feb 10 – Feb 14, 2026
  const startFmt = start.toFormat('LLL d')
  const endFmt = end.toFormat('LLL d, yyyy')
  return `Week of ${startFmt} – ${endFmt}`
}

export function nyWeekBoundsFromWeekEnd(weekEndNyKey: string): { weekStartNyKey: string; weekEndNyKey: string } {
  const end = DateTime.fromISO(weekEndNyKey, { zone: REPORT_TZ }).startOf('day')
  // Treat weekEnd as Friday; weekStart is Monday of same week.
  const weekStart = end.minus({ days: 4 })
  return { weekStartNyKey: weekStart.toFormat('yyyy-LL-dd'), weekEndNyKey }
}

export function previousCompletedWeekNy(nowUtc = DateTime.utc()): { weekStartNyKey: string; weekEndNyKey: string } {
  const nowNy = nowUtc.setZone(REPORT_TZ)
  // Find previous Friday (strictly before today if today is Fri).
  // Luxon weekday: Mon=1..Sun=7
  const weekday = nowNy.weekday
  const daysSinceFri = (weekday - 5 + 7) % 7
  const lastFri = nowNy.startOf('day').minus({ days: daysSinceFri === 0 ? 7 : daysSinceFri })
  const weekEndNyKey = lastFri.toFormat('yyyy-LL-dd')
  const weekStartNyKey = lastFri.minus({ days: 4 }).toFormat('yyyy-LL-dd')
  return { weekStartNyKey, weekEndNyKey }
}

export function nyInclusiveUtcBounds(weekStartNyKey: string, weekEndNyKey: string): { startUtcIso: string; endUtcIso: string } {
  const startNy = DateTime.fromISO(weekStartNyKey, { zone: REPORT_TZ }).startOf('day')
  const endNy = DateTime.fromISO(weekEndNyKey, { zone: REPORT_TZ }).endOf('day')
  return { startUtcIso: startNy.toUTC().toISO()!, endUtcIso: endNy.toUTC().toISO()! }
}

export function computeWeeklyExecutionMetricsFromTrades(params: {
  weekStartNyKey: string
  weekEndNyKey: string
  trades: LiveTradeRow[]
  realized_before_week: number
}): WeeklyExecutionMetrics {
  const { weekStartNyKey, weekEndNyKey } = params

  const realized_before_week = clamp2(params.realized_before_week)
  const equity_at_week_start = clamp2(INITIAL_EQUITY + realized_before_week)

  const closed_trades = params.trades.length

  let net_pnl_usd = 0
  let winners_count = 0
  let losers_count = 0

  let gross_win = 0
  let gross_loss_abs = 0

  let holdSumMs = 0
  let holdCount = 0

  const outcomes: WeeklyReportTradeOutcome = { take_profit: 0, stop_loss: 0, trailing_stop: 0, other: 0 }

  const bySymbol = new Map<string, { trades: number; net: number }>()

  let largestWin: WeeklyReportLargestTrade = { symbol: null, pnl_usd: null, return_pct: null, closed_at: null }
  let largestLoss: WeeklyReportLargestTrade = { symbol: null, pnl_usd: null, return_pct: null, closed_at: null }

  // Equity path for drawdown
  let equity = equity_at_week_start
  let peak = equity_at_week_start
  let max_drawdown_pct = 0

  // Keep per-trade computed fields for deterministic selected_trades selection
  const enriched = params.trades.map((t) => {
    const pnl = isFiniteNum(t.realized_pnl_dollars) ? t.realized_pnl_dollars : 0
    const ret = computeReturnPct(t)
    const closedAt = t.exit_timestamp
    const symbol = (t.ticker ?? '').toUpperCase() || 'UNKNOWN'
    const dir = ((t.side ?? 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT'
    const dateKey = closedAt ? nyDayKey(closedAt) : weekEndNyKey
    return { ...t, pnl, return_pct: ret, symbol, dir, dateKey }
  })

  for (const t of enriched) {
    net_pnl_usd += t.pnl

    if (t.pnl > 0) {
      winners_count += 1
      gross_win += t.pnl
    } else if (t.pnl < 0) {
      losers_count += 1
      gross_loss_abs += Math.abs(t.pnl)
    }

    const reason = (t.exit_reason ?? '').toUpperCase()
    if (reason === 'TP_HIT') outcomes.take_profit += 1
    else if (reason === 'SL_HIT') outcomes.stop_loss += 1
    else if (reason === 'TRAILING_SL_HIT') outcomes.trailing_stop += 1
    else outcomes.other += 1

    const prev = bySymbol.get(t.symbol) ?? { trades: 0, net: 0 }
    prev.trades += 1
    prev.net += t.pnl
    bySymbol.set(t.symbol, prev)

    if (largestWin.pnl_usd == null || t.pnl > (largestWin.pnl_usd ?? -Infinity)) {
      largestWin = {
        symbol: t.symbol,
        pnl_usd: clamp2(t.pnl),
        return_pct: t.return_pct != null ? clamp2(t.return_pct) : null,
        closed_at: t.exit_timestamp,
      }
    }

    if (largestLoss.pnl_usd == null || t.pnl < (largestLoss.pnl_usd ?? Infinity)) {
      largestLoss = {
        symbol: t.symbol,
        pnl_usd: clamp2(t.pnl),
        return_pct: t.return_pct != null ? clamp2(t.return_pct) : null,
        closed_at: t.exit_timestamp,
      }
    }

    const entryTs = t.entry_timestamp
    const exitTs = t.exit_timestamp
    if (entryTs && exitTs) {
      const entryMs = new Date(entryTs).getTime()
      const exitMs = new Date(exitTs).getTime()
      if (Number.isFinite(entryMs) && Number.isFinite(exitMs) && exitMs > entryMs) {
        holdSumMs += exitMs - entryMs
        holdCount += 1
      }
    }

    // Update drawdown equity path using realized pnl sequence
    equity += t.pnl
    if (equity > peak) peak = equity
    if (peak > 0) {
      const dd = ((peak - equity) / peak) * 100
      if (dd > max_drawdown_pct) max_drawdown_pct = dd
    }
  }

  net_pnl_usd = clamp2(net_pnl_usd)

  const win_rate_pct = closed_trades > 0 ? clamp2((winners_count / closed_trades) * 100) : 0

  // profit factor edge cases
  let profit_factor = 0
  let pf_note: string | undefined
  if (gross_loss_abs === 0 && gross_win > 0) {
    profit_factor = 99
    pf_note = 'No losing trades in period; profit factor capped at 99.0 for display.'
  } else if (gross_win === 0 && gross_loss_abs > 0) {
    profit_factor = 0
  } else if (gross_loss_abs > 0) {
    profit_factor = gross_win / gross_loss_abs
  }
  profit_factor = clamp2(profit_factor)

  const avg_hold_hours = holdCount > 0 ? clamp1(holdSumMs / holdCount / (1000 * 60 * 60)) : 0

  const net_return_pct = equity_at_week_start !== 0 ? clamp2((net_pnl_usd / equity_at_week_start) * 100) : 0

  const top_symbols: WeeklyReportTopSymbol[] = Array.from(bySymbol.entries())
    .map(([symbol, v]) => ({ symbol, trades: v.trades, net_pnl_usd: clamp2(v.net) }))
    .sort((a, b) => Math.abs(b.net_pnl_usd) - Math.abs(a.net_pnl_usd))
    .slice(0, 5)

  const selected_trades = selectDeterministicTrades({
    trades: enriched,
    target: 10,
  })

  const equity_at_week_end = clamp2(equity_at_week_start + net_pnl_usd)

  const metrics: WeeklyExecutionMetrics = {
    week_start: weekStartNyKey,
    week_end: weekEndNyKey,
    week_label: getNyWeekLabel(weekStartNyKey, weekEndNyKey),

    equity_at_week_start,
    equity_at_week_end,
    realized_before_week,

    closed_trades,
    winners_count,
    losers_count,
    win_rate_pct,

    net_pnl_usd,
    net_return_pct,

    profit_factor,
    ...(pf_note ? { pf_note } : {}),

    avg_hold_hours,

    max_drawdown_pct: clamp2(max_drawdown_pct),
    drawdown_method: 'closed_trade_equity_path',

    trade_outcomes: outcomes,
    top_symbols,
    // Largest win/loss are by realized_pnl_dollars (USD) among closed trades in the week.
    largest_win: closed_trades > 0 ? largestWin : { symbol: null, pnl_usd: null, return_pct: null, closed_at: null },
    largest_loss: closed_trades > 0 ? largestLoss : { symbol: null, pnl_usd: null, return_pct: null, closed_at: null },
    largest_win_usd: closed_trades > 0 && largestWin.pnl_usd != null ? clamp2(largestWin.pnl_usd) : 0,
    largest_loss_usd: closed_trades > 0 && largestLoss.pnl_usd != null ? clamp2(largestLoss.pnl_usd) : 0,

    selected_trades,
  }

  return metrics
}

export async function computeWeeklyExecutionMetrics(params: {
  weekStartNyKey: string
  weekEndNyKey: string
}): Promise<WeeklyExecutionMetrics> {
  const { weekStartNyKey, weekEndNyKey } = params

  const { startUtcIso, endUtcIso } = nyInclusiveUtcBounds(weekStartNyKey, weekEndNyKey)

  const { data: rows, error } = await supabaseAdmin
    .from('live_trades')
    .select('id,ticker,side,entry_price,exit_price,entry_timestamp,exit_timestamp,exit_reason,realized_pnl_dollars')
    .eq('strategy', 'SWING')
    .eq('engine_key', 'SWING')
    .not('exit_timestamp', 'is', null)
    .gte('exit_timestamp', startUtcIso)
    .lte('exit_timestamp', endUtcIso)
    .order('exit_timestamp', { ascending: true })
    .limit(5000)

  if (error) {
    throw new Error(`Failed to load live_trades for weekly report: ${error.message}`)
  }

  const trades = (rows ?? []) as LiveTradeRow[]

  // NOTE: PostgREST aggregates may be disabled in some Supabase projects.
  // Compute realized_before_week by summing rows in application code.
  const { data: beforeRows, error: beforeError } = await supabaseAdmin
    .from('live_trades')
    .select('realized_pnl_dollars')
    .eq('strategy', 'SWING')
    .eq('engine_key', 'SWING')
    .not('realized_pnl_dollars', 'is', null)
    .not('exit_timestamp', 'is', null)
    .lt('exit_timestamp', startUtcIso)
    .order('exit_timestamp', { ascending: false })
    .limit(10000)

  if (beforeError) {
    throw new Error(`Failed to compute realized_before_week: ${beforeError.message}`)
  }

  let realized_before_week = 0
  for (const r of beforeRows ?? []) {
    const v = (r as any)?.realized_pnl_dollars
    if (typeof v === 'number' && Number.isFinite(v)) {
      realized_before_week += v
    }
  }
  realized_before_week = clamp2(realized_before_week)

  return computeWeeklyExecutionMetricsFromTrades({
    weekStartNyKey,
    weekEndNyKey,
    trades,
    realized_before_week,
  })
}

function selectDeterministicTrades(params: {
  trades: Array<LiveTradeRow & { pnl: number; return_pct: number | null; symbol: string; dir: 'LONG' | 'SHORT'; dateKey: string }>
  target: number
}): WeeklyReportSelectedTrade[] {
  const { trades, target } = params
  if (!trades.length) return []

  const byAbs = [...trades].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
  const max = byAbs[0]
  const min = [...trades].sort((a, b) => a.pnl - b.pnl)[0]

  const picked = new Map<string, typeof trades[number]>()
  if (max) picked.set(max.id, max)
  if (min) picked.set(min.id, min)

  for (const t of byAbs) {
    if (picked.size >= target) break
    picked.set(t.id, t)
  }

  // Fill remaining deterministically by chronological close time
  if (picked.size < target) {
    const chron = [...trades].sort((a, b) => String(a.exit_timestamp ?? '').localeCompare(String(b.exit_timestamp ?? '')))
    for (const t of chron) {
      if (picked.size >= target) break
      picked.set(t.id, t)
    }
  }

  const items = Array.from(picked.values())
    .sort((a, b) => String(a.exit_timestamp ?? '').localeCompare(String(b.exit_timestamp ?? '')))
    .map((t) => ({
      date: t.dateKey,
      symbol: t.symbol,
      dir: t.dir,
      entry: isFiniteNum(t.entry_price) ? t.entry_price : null,
      exit: isFiniteNum(t.exit_price) ? t.exit_price : null,
      return_pct: t.return_pct != null ? clamp2(t.return_pct) : null,
      pnl_usd: clamp2(t.pnl),
      status: t.exit_reason ?? null,
      closed_at: t.exit_timestamp ?? null,
      trade_id: t.id,
    }))

  return items
}
