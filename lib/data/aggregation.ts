import { DateTime } from 'luxon'
import type { MinuteBar } from './alpaca'

export interface AggregatedBar {
  symbol: string
  timeframeMinutes: number
  start: DateTime
  end: DateTime
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function aggregateBars(
  symbol: string,
  minutes: number,
  window: { start: DateTime; end: DateTime },
  bars: MinuteBar[],
): AggregatedBar | null {
  const slice = bars.filter((bar) => {
    const ts = DateTime.fromISO(bar.t, { zone: 'utc' })
    return ts > window.start && ts <= window.end
  })
  if (slice.length === 0) return null
  const sorted = slice.sort((a, b) => DateTime.fromISO(a.t).toMillis() - DateTime.fromISO(b.t).toMillis())
  const open = Number(sorted[0].o)
  const close = Number(sorted[sorted.length - 1].c)
  const high = Math.max(...sorted.map((bar) => Number(bar.h)))
  const low = Math.min(...sorted.map((bar) => Number(bar.l)))
  const volume = sorted.reduce((sum, bar) => sum + Number(bar.v ?? 0), 0)
  return {
    symbol,
    timeframeMinutes: minutes,
    start: window.start,
    end: window.end,
    open,
    high,
    low,
    close,
    volume,
  }
}
