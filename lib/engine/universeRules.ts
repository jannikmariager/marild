// Pure logic and constants - safe for client components
export const UNIVERSE_PERFORMANCE = 'performance'
export const UNIVERSE_RESEARCH = 'research'

export type Horizon = 'day' | 'swing' | 'invest'

// Horizon-specific promotion criteria
export const HORIZON_CRITERIA: Record<Horizon, {
  MIN_EXPECTANCY: number
  MIN_WIN_RATE: number
  MIN_TRADES: number
  MAX_DRAWDOWN: number
}> = {
  day: {
    MIN_EXPECTANCY: 0.12,
    MIN_WIN_RATE: 0.40,
    MIN_TRADES: 60,
    MAX_DRAWDOWN: 8.0,
  },
  swing: {
    MIN_EXPECTANCY: 0.10, // Quality threshold - filters out marginal performers
    MIN_WIN_RATE: 0.40,   // 40% minimum win rate
    MIN_TRADES: 10,       // Fewer trades over 2 years
    MAX_DRAWDOWN: 12.0,   // More tolerance for drawdown
  },
  invest: {
    MIN_EXPECTANCY: 0.01, // Much lower for investor (very few trades)
    MIN_WIN_RATE: 0.50,   // Want solid win rate
    MIN_TRADES: 10,       // Very few trades over 5 years
    MAX_DRAWDOWN: 15.0,   // Higher tolerance for long-term holds
  },
}

// Legacy exports for backwards compatibility (use day criteria)
export const MIN_EXPECTANCY = HORIZON_CRITERIA.day.MIN_EXPECTANCY
export const MIN_WIN_RATE = HORIZON_CRITERIA.day.MIN_WIN_RATE
export const MIN_TRADES = HORIZON_CRITERIA.day.MIN_TRADES
export const MAX_DRAWDOWN = HORIZON_CRITERIA.day.MAX_DRAWDOWN

export type TickerStats = {
  ticker: string
  trades: number
  win_rate: number
  expectancy: number
  max_drawdown_pct: number
  profit_factor: number | null
  // Average model confidence over the last 14 calendar days across all signals for this ticker
  avg_confidence_14d?: number | null
}

export function isPromotionCandidate(stats: TickerStats, horizon: Horizon = 'day'): boolean {
  const criteria = HORIZON_CRITERIA[horizon]
  return (
    stats.trades >= criteria.MIN_TRADES &&
    stats.expectancy >= criteria.MIN_EXPECTANCY &&
    stats.win_rate >= criteria.MIN_WIN_RATE &&
    stats.max_drawdown_pct <= criteria.MAX_DRAWDOWN
  )
}

export function isRedFlag(stats: TickerStats, horizon: Horizon = 'day'): boolean {
  const criteria = HORIZON_CRITERIA[horizon]
  return (
    stats.trades >= criteria.MIN_TRADES &&
    (
      stats.expectancy < criteria.MIN_EXPECTANCY ||
      stats.win_rate < criteria.MIN_WIN_RATE ||
      stats.max_drawdown_pct > criteria.MAX_DRAWDOWN
    )
  )
}
