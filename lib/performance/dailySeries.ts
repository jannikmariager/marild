import { addDays, formatISO, parseISO } from 'date-fns'

export interface RealizedTradeRow {
  realized_pnl_date: string | null
  realized_pnl_dollars: number | null
}

export interface EquitySnapshotRow {
  timestamp?: string | null
  ts?: string | null
  equity_dollars?: number | null
}

export interface DailySeriesInput {
  startDate: Date
  endDate: Date
  startingEquity: number
  trades: RealizedTradeRow[]
  snapshots: EquitySnapshotRow[]
}

export interface DailySeriesItem {
  key: string
  realized: number
  unrealized: number
  equity: number
  cumulativeRealized: number
}

export function buildDailySeries({
  startDate,
  endDate,
  startingEquity,
  trades,
  snapshots,
}: DailySeriesInput): { order: string[]; map: Map<string, DailySeriesItem> } {
  const dayKeys: string[] = []
  for (
    let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    cursor <= endDate;
    cursor = addDays(cursor, 1)
  ) {
    dayKeys.push(formatDateKey(cursor))
  }

  const realizedByDay = new Map<string, number>()
  for (const trade of trades || []) {
    if (!trade.realized_pnl_date) continue
    const key = trade.realized_pnl_date
    const current = realizedByDay.get(key) ?? 0
    realizedByDay.set(key, current + Number(trade.realized_pnl_dollars ?? 0))
  }

  const sortedSnapshots = (snapshots || [])
    .map((snap) => {
      const iso = snap.timestamp ?? snap.ts
      if (!iso) return null
      const equity = Number(snap.equity_dollars ?? 0)
      if (!Number.isFinite(equity)) return null
      return { ts: parseISO(iso), equity }
    })
    .filter(Boolean)
    .sort((a, b) => (a!.ts.getTime() - b!.ts.getTime()))
    .map((row) => row!)

  let snapshotIndex = 0
  let lastSnapshotEquity: number | null = null

  const map = new Map<string, DailySeriesItem>()
  let cumulativeRealized = 0
  let prevUnrealized = 0

  for (const key of dayKeys) {
    const realizedToday = realizedByDay.get(key) ?? 0
    cumulativeRealized += realizedToday

    const dayEnd = new Date(`${key}T23:59:59.999Z`)
    while (snapshotIndex < sortedSnapshots.length && sortedSnapshots[snapshotIndex].ts <= dayEnd) {
      lastSnapshotEquity = sortedSnapshots[snapshotIndex].equity
      snapshotIndex += 1
    }

    const equityEstimate =
      lastSnapshotEquity ??
      startingEquity + cumulativeRealized + prevUnrealized

    const unrealized = equityEstimate - (startingEquity + cumulativeRealized)
    prevUnrealized = unrealized

    map.set(key, {
      key,
      realized: realizedToday,
      unrealized,
      equity: equityEstimate,
      cumulativeRealized,
    })
  }

  return { order: dayKeys, map }
}

function formatDateKey(date: Date) {
  return formatISO(date, { representation: 'date' })
}
