import { DateTime } from 'luxon'

export interface MarketClockConfig {
  ingestStartEt: string
  ingestEndEt: string
  tradeStartEt: string
  tradeEndEt: string
  dataFreshnessMinutes: number
  holidays: string[]
}

const DEFAULT_CONFIG: MarketClockConfig = {
  ingestStartEt: process.env.INGEST_START_ET || '09:00',
  ingestEndEt: process.env.INGEST_END_ET || '16:10',
  tradeStartEt: process.env.TRADE_GATE_START_ET || '10:00',
  tradeEndEt: process.env.TRADE_GATE_END_ET || '15:55',
  dataFreshnessMinutes: Number(process.env.DATA_FRESHNESS_MAX_MINUTES ?? 2),
  holidays: JSON.parse(process.env.MARKET_HOLIDAYS_JSON || '["2026-01-01","2026-01-19","2026-02-16","2026-03-30","2026-05-25","2026-07-03","2026-09-07","2026-11-26","2026-12-25"]'),
}

function getEtDate(now?: DateTime) {
  return (now ?? DateTime.utc()).setZone('America/New_York')
}

export function isHoliday(now?: DateTime, config: MarketClockConfig = DEFAULT_CONFIG) {
  const et = getEtDate(now)
  const ymd = et.toFormat('yyyy-LL-dd')
  return config.holidays.includes(ymd)
}

export function isTradingDay(now?: DateTime, config: MarketClockConfig = DEFAULT_CONFIG) {
  const et = getEtDate(now)
  const weekday = et.weekday // 1 = Monday
  if (weekday === 6 || weekday === 7) return false
  if (isHoliday(et, config)) return false
  return true
}

function parseEtTime(etStr: string) {
  const [hh, mm] = etStr.split(':').map((part) => Number(part))
  return { hh, mm }
}

function isWithinWindow(nowEt: DateTime, startEt: string, endEt: string) {
  const { hh: startH, mm: startM } = parseEtTime(startEt)
  const { hh: endH, mm: endM } = parseEtTime(endEt)
  const start = nowEt.set({ hour: startH, minute: startM, second: 0, millisecond: 0 })
  const end = nowEt.set({ hour: endH, minute: endM, second: 0, millisecond: 0 })
  return nowEt >= start && nowEt <= end
}

export function shouldIngest(now?: DateTime, config: MarketClockConfig = DEFAULT_CONFIG) {
  const et = getEtDate(now)
  return isTradingDay(et, config) && isWithinWindow(et, config.ingestStartEt, config.ingestEndEt)
}

export function shouldTrade(now?: DateTime, config: MarketClockConfig = DEFAULT_CONFIG) {
  const et = getEtDate(now)
  return isTradingDay(et, config) && isWithinWindow(et, config.tradeStartEt, config.tradeEndEt)
}

export function isPreTradeGate(now?: DateTime, config: MarketClockConfig = DEFAULT_CONFIG) {
  const et = getEtDate(now)
  if (!isTradingDay(et, config)) return true
  const { hh: startH, mm: startM } = parseEtTime(config.tradeStartEt)
  const gate = et.set({ hour: startH, minute: startM, second: 0, millisecond: 0 })
  return et < gate
}

export function lastCompletedCandleClose(
  timeframeMinutes: number,
  now?: DateTime,
) {
  const et = getEtDate(now).set({ second: 0, millisecond: 0 })
  const minutesSinceMidnight = et.hour * 60 + et.minute
  let completed = Math.floor(minutesSinceMidnight / timeframeMinutes) * timeframeMinutes
  // If exactly on boundary, drop back one candle to ensure "completed"
  if (minutesSinceMidnight % timeframeMinutes === 0) {
    completed -= timeframeMinutes
  }
  if (completed < 0) return null
  const close = et.startOf('day').plus({ minutes: completed })
  return close
}

export function candleWindow(
  timeframeMinutes: number,
  now?: DateTime,
): { start: DateTime; end: DateTime } | null {
  const close = lastCompletedCandleClose(timeframeMinutes, now)
  if (!close) return null
  const start = close.minus({ minutes: timeframeMinutes }).plus({ minute: 0 })
  return { start, end: close }
}

export function maxDataStalenessMinutes(config: MarketClockConfig = DEFAULT_CONFIG) {
  return config.dataFreshnessMinutes
}

export const marketClock = {
  config: DEFAULT_CONFIG,
  getEtDate,
  isTradingDay,
  shouldIngest,
  shouldTrade,
  isPreTradeGate,
  candleWindow,
  lastCompletedCandleClose,
  maxDataStalenessMinutes,
}
