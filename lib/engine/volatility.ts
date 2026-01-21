import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MinuteBar } from '@/lib/data/alpaca'
import { aggregateBars, type AggregatedBar } from '@/lib/data/aggregation'

export type VolatilityState = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME'

const ATR_PERIOD = 14
const HOURLY_BARS_REQUIRED = ATR_PERIOD + 1
export const VOLATILITY_MINUTE_LOOKBACK_HOURS = ATR_PERIOD + 6 // buffer beyond ATR requirement
const PERCENTILE_HISTORY_LIMIT = 360
const MIN_HISTORY_FOR_PERCENTILE = 20

interface VolatilityContext {
  state: VolatilityState
  percentile: number
  atr: number
  explanation: string
}

interface EvaluateOptions {
  symbol: string
  timeframe: string
  minuteBars: MinuteBar[]
  latestWindowEnd: DateTime
  supabase: SupabaseClient
}

export async function evaluateVolatility({
  symbol,
  timeframe,
  minuteBars,
  latestWindowEnd,
  supabase,
}: EvaluateOptions): Promise<VolatilityContext> {
  const hourlySeries = buildHourlySeries(symbol, latestWindowEnd, minuteBars, HOURLY_BARS_REQUIRED)
  if (!hourlySeries) {
    return {
      state: 'NORMAL',
      percentile: 50,
      atr: 0,
      explanation: 'Insufficient intraday data to evaluate volatility independently.',
    }
  }

  const atr = calculateAtr(hourlySeries, ATR_PERIOD)
  if (atr === null) {
    return {
      state: 'NORMAL',
      percentile: 50,
      atr: 0,
      explanation: 'Unable to compute ATR(14) for volatility context.',
    }
  }

  const { percentile, samples } = await fetchAtrPercentile({
    symbol,
    timeframe,
    atr,
    supabase,
  })

  const state = mapPercentileToState(percentile)
  const explanation = buildExplanation({ atr, percentile, samples })

  return {
    state,
    percentile,
    atr,
    explanation,
  }
}

function buildHourlySeries(
  symbol: string,
  latestWindowEnd: DateTime,
  minuteBars: MinuteBar[],
  count: number,
): AggregatedBar[] | null {
  const series: AggregatedBar[] = []
  for (let i = count; i >= 1; i--) {
    const offsetHours = i - 1
    const end = latestWindowEnd.minus({ hours: offsetHours })
    const start = end.minus({ hours: 1 })
    const bar = aggregateBars(symbol, 60, { start, end }, minuteBars)
    if (!bar) {
      return null
    }
    series.push(bar)
  }
  return series
}

function calculateAtr(bars: AggregatedBar[], period: number): number | null {
  if (bars.length < period + 1) return null
  const trueRanges: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const current = bars[i]
    const prev = bars[i - 1]
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    )
    trueRanges.push(tr)
  }
  if (trueRanges.length < period) return null
  const firstAtr =
    trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period
  if (trueRanges.length === period) {
    return firstAtr
  }
  let atr = firstAtr
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period
  }
  return atr
}

async function fetchAtrPercentile({
  symbol,
  timeframe,
  atr,
  supabase,
}: {
  symbol: string
  timeframe: string
  atr: number
  supabase: SupabaseClient
}): Promise<{ percentile: number; samples: number }> {
  const { data, error } = await supabase
    .from('ai_signals')
    .select('volatility_atr')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .not('volatility_atr', 'is', null)
    .order('signal_bar_ts', { ascending: false })
    .limit(PERCENTILE_HISTORY_LIMIT)

  if (error) {
    console.error('Failed to load volatility history', error)
    return { percentile: 50, samples: 0 }
  }

  const values =
    data?.map((row) => Number(row.volatility_atr)).filter((val) => Number.isFinite(val)) ?? []
  if (!values.length) {
    return { percentile: 50, samples: 0 }
  }

  const percentile = computePercentileRank(values, atr)
  return { percentile, samples: values.length }
}

function computePercentileRank(values: number[], target: number): number {
  if (!values.length) return 50
  const below = values.filter((val) => val <= target).length
  const percentile = Math.round((below / (values.length + 1)) * 100)
  return Math.max(1, Math.min(99, percentile))
}

function mapPercentileToState(percentile: number): VolatilityState {
  if (percentile < 25) return 'LOW'
  if (percentile < 60) return 'NORMAL'
  if (percentile < 85) return 'HIGH'
  return 'EXTREME'
}

function buildExplanation({
  atr,
  percentile,
  samples,
}: {
  atr: number
  percentile: number
  samples: number
}): string {
  if (samples < MIN_HISTORY_FOR_PERCENTILE) {
    return `ATR(14)=${atr.toFixed(4)} with limited history (${samples} samples). Directional logic unchanged.`
  }
  const label =
    percentile > 85
      ? 'extreme range expansion'
      : percentile > 60
        ? 'elevated volatility'
        : percentile < 25
          ? 'suppressed volatility'
          : 'normal range'
  return `ATR(14)=${atr.toFixed(4)} sits in the ${percentile}th percentile (${label}). Direction remains independent.`
}
