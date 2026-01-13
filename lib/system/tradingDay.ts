import { DateTime } from 'luxon'

// Returns YYYY-MM-DD in America/New_York for the current moment
export function currentTradingDate(nowUtcISO?: string): string {
  const now = nowUtcISO ? DateTime.fromISO(nowUtcISO, { zone: 'utc' }) : DateTime.utc()
  const ny = now.setZone('America/New_York')
  return ny.toFormat('yyyy-LL-dd')
}

export function isWeekendInET(nowUtcISO?: string): boolean {
  const now = nowUtcISO ? DateTime.fromISO(nowUtcISO, { zone: 'utc' }) : DateTime.utc()
  const ny = now.setZone('America/New_York')
  const weekday = ny.weekday // 1=Mon ... 7=Sun
  return weekday === 6 || weekday === 7
}
