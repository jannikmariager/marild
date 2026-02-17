import { DateTime } from 'luxon'
import { REPORT_TZ } from '@/lib/reports/weekly/metrics'

const clamp2 = (n: number): number => Math.round(n * 100) / 100

// Fetch SPY daily closes via the existing get_chart_v2 Supabase function and
// compute a simple buy-and-hold return for the ET week window.
//
// Price selection rule (documented for future reference):
// - start_price = close of the first trading day whose date (ET) is between
//   week_start and week_end inclusive (typically Monday close).
// - end_price   = close of the last trading day whose date (ET) is between
//   week_start and week_end inclusive (typically Friday close).
//
// The week_start/week_end inputs are NY date keys (yyyy-MM-dd) matching the
// existing weekly_execution_reports window (Mon 00:00 ET – Fri 23:59 ET).
//
// If we cannot obtain at least two valid closes in that window, this returns null.
export async function fetchSpyWeeklyReturnPct(params: {
  weekStartNyKey: string
  weekEndNyKey: string
}): Promise<number | null> {
  const { weekStartNyKey, weekEndNyKey } = params

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null
  const token =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    null

  if (!supabaseUrl || !token) {
    return null
  }

  // Use a conservative range (6mo) which comfortably covers the weekly window
  // without over-fetching multiple years of data.
  const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticker: 'SPY', range: '6mo', interval: '1d' }),
  }).catch(() => null)

  if (!resp || !resp.ok) {
    return null
  }

  const json = (await resp.json().catch(() => null)) as
    | { timestamps?: number[]; closes?: number[] }
    | null
  if (!json || !Array.isArray(json.timestamps) || !Array.isArray(json.closes)) {
    return null
  }

  const { timestamps, closes } = json

  type Candle = { dateKeyNy: string; close: number }
  const candles: Candle[] = []

  for (let i = 0; i < Math.min(timestamps.length, closes.length); i += 1) {
    const ts = timestamps[i]
    const close = closes[i]
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    if (typeof close !== 'number' || !Number.isFinite(close)) continue

    const dtNy = DateTime.fromSeconds(ts, { zone: REPORT_TZ })
    if (!dtNy.isValid) continue
    const dateKeyNy = dtNy.toFormat('yyyy-LL-dd')
    candles.push({ dateKeyNy, close })
  }

  if (!candles.length) return null

  const startKey = weekStartNyKey
  const endKey = weekEndNyKey

  const windowCandles = candles
    .filter((c) => c.dateKeyNy >= startKey && c.dateKeyNy <= endKey)
    .sort((a, b) => (a.dateKeyNy < b.dateKeyNy ? -1 : a.dateKeyNy > b.dateKeyNy ? 1 : 0))

  if (windowCandles.length < 2) return null

  const startPrice = windowCandles[0]!.close
  const endPrice = windowCandles[windowCandles.length - 1]!.close

  if (!(startPrice > 0) || !(endPrice > 0)) return null

  const rawReturn = ((endPrice - startPrice) / startPrice) * 100
  return clamp2(rawReturn)
}
