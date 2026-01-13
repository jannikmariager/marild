import {
  loadTickerStats,
  loadUniverse,
  getUniverseName,
  type Horizon,
  UNIVERSE_RESEARCH,
} from '@/lib/engine/universeEvaluation'
import { UniverseTabClient } from './UniverseTabClient'

type Props = {
  engineVersion: string
  horizon: Horizon
}

export async function UniverseTab({ engineVersion, horizon }: Props) {
  const performanceUniverseName = getUniverseName(horizon)

  const [stats, performanceUniverse] = await Promise.all([
    loadTickerStats(engineVersion, horizon),
    loadUniverse(performanceUniverseName),
  ])

  // Use all backtest results as "research" candidates instead of filtering by research universe
  const allTickers = stats.map(s => s.ticker)

  return (
    <UniverseTabClient
      engineVersion={engineVersion}
      horizon={horizon}
      stats={stats}
      performanceUniverse={performanceUniverse}
      researchUniverse={allTickers}
    />
  )
}
