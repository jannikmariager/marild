import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabaseServer'
import { buildDailySeries, type EquitySnapshotRow } from '@/lib/performance/dailySeries'
import { INITIAL_EQUITY } from '@/lib/performance/metrics'

export const dynamic = 'force-dynamic'

const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type DaySummary = {
  date: string
  strategy: string
  total_pnl: number
  realized_pnl: number
  unrealized_pnl: number
  equity: number
  trades_count: number
  winners: number
  losers: number
  flats: number
}

type JournalTradeRow = {
  ticker: string | null
  strategy: string
  side: string | null
  entry_timestamp: string | null
  entry_price: number | null
  exit_timestamp: string | null
  exit_price: number | null
  size_shares: number | null
  realized_pnl_dollars: number | null
  realized_pnl_r: number | null
  exit_reason: string | null
  engine_version: string | null
  realized_pnl_date: string | null
}

type TradesByDayItem = {
  ticker: string | null
  strategy: string
  side: string
  entry_timestamp: string | null
  entry_price: number | null
  exit_timestamp: string | null
  exit_price: number | null
  size_shares: number | null
  realized_pnl_dollars: number
  realized_pnl_r: number | null
  exit_reason: string | null
  is_optimization_exit: boolean
}

type OpenPositionRow = {
  unrealized_pnl_dollars: number | null
}

const STARTING_EQUITY = INITIAL_EQUITY

// GET /api/performance/journal?strategy=SWING&days=90
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const strategy = searchParams.get('strategy') || 'SWING'
    const days = parseInt(searchParams.get('days') || '90', 10)

    const now = new Date()
    const endDate = new Date(now)
    endDate.setUTCHours(23, 59, 59, 999)
    const since = new Date(now)
    since.setUTCDate(since.getUTCDate() - days)
    since.setUTCHours(0, 0, 0, 0)
    const sinceDateKey = since.toISOString().slice(0, 10)

    // Fetch active engine versions to gate which trades we include
    const engineKeyMap: Record<string, string> = {
      SWING: 'SWING',
      DAYTRADE: 'DAYTRADE',
    }
    const engineKey = engineKeyMap[strategy.toUpperCase()] ?? 'SWING'

    const { data: activeEngines, error: activeError } = await serviceSupabase
      .from('engine_versions')
      .select('engine_version')
      .eq('engine_key', engineKey)
      .eq('run_mode', 'PRIMARY')
      .eq('is_enabled', true)
      .is('stopped_at', null)

    if (activeError) {
      console.error('[performance/journal] Error fetching active engine versions:', activeError)
    }

    const activeEngineVersions = (activeEngines || []).map((row) => row.engine_version)
    if (engineKey === 'SWING') {
      activeEngineVersions.push('BASELINE')
    }
    const engineVersionSet = new Set(activeEngineVersions.filter(Boolean))
    const shouldFilterByEngine = engineVersionSet.size > 0

    // Fetch realized trades grouped by close date
    const { data: trades, error: tradesError } = await supabase
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
          'realized_pnl_date',
        ].join(', '),
      )
      .eq('strategy', strategy)
      .not('realized_pnl_dollars', 'is', null)
      .gte('realized_pnl_date', sinceDateKey)
      .order('realized_pnl_date', { ascending: true })

    if (tradesError) {
      console.error('[performance/journal] Error fetching trades:', tradesError)
      return NextResponse.json({ error: 'Failed to load journal data' }, { status: 500 })
    }

    const supabaseTradeRows: unknown[] = Array.isArray(trades) ? trades : []
    const safeTrades: JournalTradeRow[] = supabaseTradeRows.filter(
      (row): row is JournalTradeRow =>
        row != null && typeof row === 'object' && 'strategy' in row && 'realized_pnl_dollars' in row,
    )
    const filteredTrades = shouldFilterByEngine
      ? safeTrades.filter((t) => (t.engine_version ? engineVersionSet.has(t.engine_version) : false))
      : safeTrades

    // Fetch portfolio state snapshots for mark-to-market
    const { data: portfolioSnapshots, error: snapshotError } = await supabase
      .from('live_portfolio_state')
      .select('equity_dollars, timestamp, ts')
      .eq('strategy', strategy)
      .gte('timestamp', since.toISOString())
      .order('timestamp', { ascending: true })

    if (snapshotError) {
      console.error('[performance/journal] Error fetching portfolio snapshots:', snapshotError)
    }

    // Current unrealized from open positions (authoritative for latest day)
    const { data: openPositions, error: openPosError } = await supabase
      .from('live_positions')
      .select('unrealized_pnl_dollars')
      .eq('strategy', strategy)

    if (openPosError) {
      console.error('[performance/journal] Error fetching open positions:', openPosError)
    }

    const openPositionRows: OpenPositionRow[] = (openPositions ?? []) as OpenPositionRow[]
    const currentUnrealizedFromPositions = openPositionRows.reduce(
      (sum, p) => sum + Number(p.unrealized_pnl_dollars ?? 0),
      0,
    )

    // Build per-day realized/unrealized/equity series
    const { order: dayOrder, map: dailyMap } = buildDailySeries({
      startDate: since,
      endDate,
      startingEquity: STARTING_EQUITY,
      trades: filteredTrades.map((t) => ({
        realized_pnl_date: t.realized_pnl_date ?? (t.exit_timestamp ? t.exit_timestamp.slice(0, 10) : null),
        realized_pnl_dollars: t.realized_pnl_dollars ?? 0,
      })),
      snapshots: (portfolioSnapshots as EquitySnapshotRow[]) || [],
    })

    const latestKey = dayOrder[dayOrder.length - 1]
    if (latestKey) {
      const latest = dailyMap.get(latestKey)
      if (latest) {
        latest.unrealized = currentUnrealizedFromPositions
        latest.equity = STARTING_EQUITY + latest.cumulativeRealized + latest.unrealized
        dailyMap.set(latestKey, latest)
      }
    }

    // Build summaries + trades grouped by realized date
    const daySummariesMap = new Map<string, DaySummary>()
    const tradesByDay: Record<string, TradesByDayItem[]> = {}

    const ensureSummary = (key: string, strategyKey: string): DaySummary => {
      if (!daySummariesMap.has(key)) {
        daySummariesMap.set(key, {
          date: key,
          strategy: strategyKey,
          total_pnl: 0,
          realized_pnl: 0,
          unrealized_pnl: 0,
          equity: STARTING_EQUITY,
          trades_count: 0,
          winners: 0,
          losers: 0,
          flats: 0,
        })
      }
      return daySummariesMap.get(key)!
    }

    for (const trade of filteredTrades) {
      const key =
        trade.realized_pnl_date ??
        (trade.exit_timestamp ? trade.exit_timestamp.slice(0, 10) : null)

      if (!key) continue
      const summary = ensureSummary(key, trade.strategy)
      const realized = Number(trade.realized_pnl_dollars ?? 0)
      summary.total_pnl += realized
      summary.trades_count += 1
      if (realized > 0) summary.winners += 1
      else if (realized < 0) summary.losers += 1
      else summary.flats += 1

      if (!tradesByDay[key]) tradesByDay[key] = []
      tradesByDay[key].push({
        ticker: trade.ticker,
        strategy: trade.strategy,
        side: trade.side || 'LONG',
        entry_timestamp: trade.entry_timestamp,
        entry_price: trade.entry_price,
        exit_timestamp: trade.exit_timestamp,
        exit_price: trade.exit_price,
        size_shares: trade.size_shares,
        realized_pnl_dollars: realized,
        realized_pnl_r: trade.realized_pnl_r,
        exit_reason: trade.exit_reason,
        is_optimization_exit:
          trade.exit_reason === 'CAPITAL_RECYCLE_LOW_MOMENTUM' ||
          trade.exit_reason === 'SLOT_RELEASE_REPLACEMENT',
      })
    }

    for (const key of dayOrder) {
      const summary = ensureSummary(key, strategy)
      const daily = dailyMap.get(key)
      if (daily) {
        summary.realized_pnl = daily.realized
        summary.unrealized_pnl = daily.unrealized
        summary.total_pnl = daily.realized
        summary.equity = daily.equity
      }
      daySummariesMap.set(key, summary)
    }

    const daysList = dayOrder.map((key) => daySummariesMap.get(key)!).filter(Boolean)

    const latestDaily = latestKey ? dailyMap.get(latestKey) : null
    const sinceInceptionRealized = latestDaily?.cumulativeRealized ?? 0
    const currentUnrealized = latestDaily?.unrealized ?? 0
    const sinceInceptionTotal = sinceInceptionRealized + currentUnrealized
    const currentEquity = latestDaily?.equity ?? (STARTING_EQUITY + sinceInceptionTotal)

    return NextResponse.json({
      strategy,
      days: daysList,
      tradesByDay,
      totals: {
        starting_equity: STARTING_EQUITY,
        current_equity: currentEquity,
        since_inception_realized_pnl: sinceInceptionRealized,
        current_unrealized_pnl: currentUnrealized,
        since_inception_total_pnl: sinceInceptionTotal,
      },
      meta: {
        lookback_days: days,
        total_trading_days: dayOrder.length,
        total_trades: filteredTrades.length,
      },
    })
  } catch (error) {
    console.error('[performance/journal] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
