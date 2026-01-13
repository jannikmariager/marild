// Server-only functions for universe data loading
import { createAdminClient } from '@/lib/supabase/server'
import type { TickerStats } from './universeRules'

export * from './universeRules'

export type Horizon = 'day' | 'swing' | 'invest'

export function getUniverseName(horizon: Horizon): string {
  return `performance_${horizon}`
}

async function getSupabase() {
  const supabase = await createAdminClient()
  return supabase
}

export async function loadTickerStats(
  engineVersion: string,
  horizon: Horizon | null = null
): Promise<TickerStats[]> {
  const supabase = await getSupabase()

  const { data, error } = await supabase.rpc('engine_ticker_stats', {
    engine_version_arg: engineVersion,
    horizon_arg: horizon,
  })

  if (error) {
    console.error('[admin/loadTickerStats] rpc error', error)
    throw error
  }

  const baseStats = (data || []) as TickerStats[]

  // Enrich with 14-day average confidence per ticker, based on all generated signals
  if (baseStats.length === 0) {
    return baseStats
  }

  try {
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const tickers = baseStats.map((s) => s.ticker.toUpperCase())

    // Supabase JS client does not support .group(); fetch raw rows and aggregate in memory
    const { data: confidenceRows, error: confidenceError } = await supabase
      .from('ai_signals')
      .select('symbol, confidence_score')
      .gte('created_at', fourteenDaysAgo.toISOString())
      .in('symbol', tickers)

    if (confidenceError) {
      console.error('[admin/loadTickerStats] confidence avg error', confidenceError)
      return baseStats
    }

    const confidenceMap = new Map<string, { sum: number; count: number }>()
    for (const row of confidenceRows || []) {
      const symbol = (row as any).symbol as string | null
      const confidence = (row as any).confidence_score as number | null
      if (!symbol || confidence == null) continue
      const key = symbol.toUpperCase()
      const current = confidenceMap.get(key) ?? { sum: 0, count: 0 }
      current.sum += confidence
      current.count += 1
      confidenceMap.set(key, current)
    }

    return baseStats.map((s) => {
      const agg = confidenceMap.get(s.ticker.toUpperCase())
      const avg = agg && agg.count > 0 ? agg.sum / agg.count : null
      return {
        ...s,
        avg_confidence_14d: avg,
      }
    })
  } catch (confidenceException) {
    console.error('[admin/loadTickerStats] unexpected confidence avg exception', confidenceException)
    return baseStats
  }
}

export async function loadUniverse(name: string): Promise<string[]> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('engine_universe')
    .select('tickers')
    .eq('universe_name', name)
    .maybeSingle()

  if (error) {
    console.error('[admin/loadUniverse] error', error)
    throw error
  }

  return ((data?.tickers as string[]) || []).map((t) => t.toUpperCase())
}
