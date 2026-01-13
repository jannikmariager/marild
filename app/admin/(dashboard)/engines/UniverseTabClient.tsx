'use client'

import { useMemo, useTransition, useState } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  TickerStats,
  isPromotionCandidate,
  isRedFlag,
  HORIZON_CRITERIA,
  type Horizon as HorizonType,
} from '@/lib/engine/universeRules'
import {
  promoteTickerToPerformance,
  demoteTickerFromPerformance,
  type Horizon,
} from './universeActions'

const ENGINE_VERSIONS = ['v7.2', 'v7.3', 'v7.4'] as const

type HorizonConfig = {
  label: string
  timeframe: string
  period: string
  engine: string
}

const HORIZON_CONFIGS: Record<Horizon, HorizonConfig> = {
  day: { label: 'Daytrade', timeframe: '5m', period: '365 days', engine: 'v7.4' },
  swing: { label: 'Swing', timeframe: '4h', period: '2 years', engine: 'v1' },
  invest: { label: 'Investor', timeframe: '1d', period: '5 years', engine: 'v4.9' },
}

type Props = {
  engineVersion: string
  horizon: Horizon
  stats: TickerStats[]
  performanceUniverse: string[]
  researchUniverse: string[]
}

export function UniverseTabClient({ engineVersion, horizon, stats, performanceUniverse, researchUniverse }: Props) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filterTicker, setFilterTicker] = useState('')
  const [filterMinExpectancy, setFilterMinExpectancy] = useState<number | null>(null)
  const [unpromotedSort, setUnpromotedSort] = useState<'expectancy' | 'ticker' | 'avg_conf'>('expectancy')

  const performanceSet = new Set(performanceUniverse.map((t) => t.toUpperCase()))
  const researchSet = new Set(researchUniverse.map((t) => t.toUpperCase()))

  // Basic filters: ticker substring + minimum expectancy (R)
  const applyFilters = (rows: TickerStats[]): TickerStats[] => {
    return rows.filter((s) => {
      if (filterTicker && !s.ticker.toUpperCase().includes(filterTicker.toUpperCase())) {
        return false
      }
      if (filterMinExpectancy != null && s.expectancy < filterMinExpectancy) {
        return false
      }
      return true
    })
  }

  const inPerformance = applyFilters(stats.filter((s) => performanceSet.has(s.ticker.toUpperCase())))
  const inResearch = applyFilters(stats.filter((s) => researchSet.has(s.ticker.toUpperCase())))

  const promotionCandidates = inResearch.filter(
    (s) => !performanceSet.has(s.ticker.toUpperCase()) && isPromotionCandidate(s, horizon)
  )

  const redFlags = inPerformance.filter((s) => isRedFlag(s, horizon))

  const topResearch = inResearch
    .slice()
    .sort((a, b) => b.expectancy - a.expectancy)
    .slice(0, 25)

  const horizonConfig = HORIZON_CONFIGS[horizon]

  const handlePromote = (ticker: string) => {
    startTransition(async () => {
      try {
        await promoteTickerToPerformance(ticker, horizon)
        router.refresh()
      } catch (error) {
        console.error('Failed to promote ticker:', error)
        alert('Failed to promote ticker. Check console for details.')
      }
    })
  }

  const handleDemote = (ticker: string) => {
    startTransition(async () => {
      try {
        await demoteTickerFromPerformance(ticker, horizon)
        router.refresh()
      } catch (error) {
        console.error('Failed to demote ticker:', error)
        alert('Failed to demote ticker. Check console for details.')
      }
    })
  }

  const handleVersionChange = (nextVersion: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('engineVersion', nextVersion)
    router.push(`${pathname}?${params.toString()}`)
  }

  const criteria = HORIZON_CRITERIA[horizon]
  
  const thresholdBadge = (
    <div className="text-xs text-muted-foreground">
      Rules: expectancy ≥ {criteria.MIN_EXPECTANCY.toFixed(2)}R, win% ≥ {(criteria.MIN_WIN_RATE * 100).toFixed(0)}%, trades ≥{' '}
      {criteria.MIN_TRADES}, DD ≤ {criteria.MAX_DRAWDOWN.toFixed(1)}%
    </div>
  )

  const sortedPerformance = inPerformance
    .slice()
    .sort((a, b) => b.expectancy - a.expectancy)

  // All researched tickers that are NOT currently promoted
  const allSorted = applyFilters(
    stats.filter((s) => !performanceSet.has(s.ticker.toUpperCase())),
  )
    .slice()
    .sort((a, b) => {
      if (unpromotedSort === 'ticker') {
        return a.ticker.localeCompare(b.ticker)
      }
      if (unpromotedSort === 'avg_conf') {
        const avga = a.avg_confidence_14d ?? -Infinity
        const avgb = b.avg_confidence_14d ?? -Infinity
        // Sort by average confidence descending (best on top)
        return avgb - avga
      }
      // default: sort by expectancy (R) descending
      return b.expectancy - a.expectancy
    })

  return (
    <div className="space-y-6">
      {/* Horizon Header with Badge */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-foreground">{horizonConfig.label} Performance Universe — Engine {engineVersion}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Engine version:</span>
            <select
              value={engineVersion}
              onChange={(e) => handleVersionChange(e.target.value)}
              className="border border-input bg-background px-2 py-1 rounded-md text-xs text-foreground"
            >
              {ENGINE_VERSIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* Horizon Info Badge */}
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-indigo-700 border border-indigo-200">
            🎯 Horizon: {horizonConfig.label} ({horizonConfig.timeframe}, {horizonConfig.period})
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-blue-700 border border-blue-200">
            🔧 Engine: {horizonConfig.engine}
          </span>
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 border border-emerald-200">
            📈 Filters: Exp ≥{criteria.MIN_EXPECTANCY.toFixed(2)}R, Win≥{(criteria.MIN_WIN_RATE * 100).toFixed(0)}%, Trades≥{criteria.MIN_TRADES}, DD≤{criteria.MAX_DRAWDOWN.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Global filters for ticker and expectancy (R) */}
      <Card className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Ticker filter:</span>
            <input
              value={filterTicker}
              onChange={(e) => setFilterTicker(e.target.value)}
              placeholder="e.g. AAPL"
              className="border border-input bg-background px-2 py-1 rounded-md text-xs text-foreground min-w-[120px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span>Min expectancy (R):</span>
            <select
              value={filterMinExpectancy == null ? '' : String(filterMinExpectancy)}
              onChange={(e) => {
                const v = e.target.value
                setFilterMinExpectancy(v === '' ? null : Number(v))
              }}
              className="border border-input bg-background px-2 py-1 rounded-md text-xs text-foreground"
            >
              <option value="">All</option>
              <option value="0.00">≥ 0.00R</option>
              <option value="0.05">≥ 0.05R</option>
              <option value="0.10">≥ 0.10R</option>
              <option value="0.20">≥ 0.20R</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Promoted tickers ({inPerformance.length})</h3>
          <div className="text-xs text-muted-foreground">
            Only promoted tickers are traded live by the engine
          </div>
        </div>
          {inPerformance.length === 0 ? (
            <div className="text-sm text-muted-foreground mt-2">
              No tickers in performance universe.
            </div>
          ) : (
          <UniverseTable rows={sortedPerformance} actionLabel="Demote" onAction={handleDemote} />
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-foreground">Promotion Candidates (Research → {horizonConfig.label})</h3>
        {thresholdBadge}
        {promotionCandidates.length === 0 ? (
          <div className="text-sm text-muted-foreground mt-2">
            No promotion candidates under current rules.
          </div>
        ) : (
          <UniverseTable
            rows={promotionCandidates}
            actionLabel={`Promote to ${horizonConfig.label}`}
            onAction={handlePromote}
          />
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-foreground">All tested tickers ({allSorted.length})</h3>
            <div className="text-xs text-muted-foreground">
              Full swing research universe from backtests (including non-promoted names)
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Sort:</span>
            <button
              type="button"
              onClick={() => setUnpromotedSort('expectancy')}
              className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                unpromotedSort === 'expectancy'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-background text-foreground border-border hover:border-foreground/40'
              }`}
            >
              by Expectancy (R)
            </button>
            <button
              type="button"
              onClick={() => setUnpromotedSort('avg_conf')}
              className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                unpromotedSort === 'avg_conf'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-background text-foreground border-border hover:border-foreground/40'
              }`}
            >
              by Avg Conf (14d)
            </button>
            <button
              type="button"
              onClick={() => setUnpromotedSort('ticker')}
              className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                unpromotedSort === 'ticker'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-background text-foreground border-border hover:border-foreground/40'
              }`}
            >
              by Ticker A–Z
            </button>
          </div>
        </div>
        {allSorted.length === 0 ? (
          <div className="text-sm text-muted-foreground mt-2">
            No backtest stats available yet for this engine version.
          </div>
        ) : (
          <UniverseTable
            rows={allSorted}
            actionLabel="Promote"
            onAction={handlePromote}
          />
        )}
      </Card>

      {isPending && (
        <div className="text-xs text-muted-foreground">Updating universe…</div>
      )}
    </div>
  )
}

type TableProps = {
  rows: TickerStats[]
  actionLabel?: string
  onAction?: (ticker: string) => void
  hideAction?: boolean
}

function UniverseTable({ rows, actionLabel = '', onAction, hideAction }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left py-1">Ticker</th>
            <th className="text-right py-1">Trades</th>
            <th className="text-right py-1">Win %</th>
            <th className="text-right py-1">Expectancy (R)</th>
            <th className="text-right py-1">Avg Conf (14d)</th>
            <th className="text-right py-1">DD %</th>
            <th className="text-right py-1">Profit Factor</th>
            {!hideAction && <th className="text-right py-1"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="border-b border-border last:border-none">
              <td className="py-1 font-mono text-foreground">{r.ticker}</td>
              <td className="py-1 text-right text-foreground">{r.trades}</td>
              <td className="py-1 text-right text-foreground">{(r.win_rate * 100).toFixed(1)}%</td>
              <td className="py-1 text-right text-foreground">{r.expectancy.toFixed(3)}</td>
              <td className="py-1 text-right text-foreground">
                {r.avg_confidence_14d == null ? (
                  '—'
                ) : (
                  <span
                    className={`inline-flex items-center justify-end rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.avg_confidence_14d >= 65
                        ? 'bg-emerald-100 text-emerald-800'
                        : r.avg_confidence_14d >= 55
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {r.avg_confidence_14d.toFixed(1)}%
                  </span>
                )}
              </td>
              <td className="py-1 text-right text-foreground">{r.max_drawdown_pct.toFixed(1)}</td>
              <td className="py-1 text-right text-foreground">
                {r.profit_factor == null
                  ? '-'
                  : Number.isFinite(r.profit_factor)
                  ? r.profit_factor.toFixed(2)
                  : '∞'}
              </td>
              {!hideAction && onAction && (
                <td className="py-2 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onAction(r.ticker)}
                    className="font-medium px-4 py-2"
                  >
                    {actionLabel}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
