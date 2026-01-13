'use client'

import { useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { VariantScoreCard } from './VariantScoreCard'
import { VariantHeatmap } from './VariantHeatmap'
import { VariantTable } from './VariantTable'
import { VariantDetailModal } from './VariantDetailModal'

export interface VariantAggregateRowClient {
  filter_variant: string
  engine_version: string
  avg_win_rate: number | null
  avg_expectancy: number | null
  avg_avg_rr: number | null
  avg_total_return: number | null
  avg_drawdown: number | null
  avg_profit_factor: number | null
  signals_per_ticker: number | null
  trades_per_ticker: number | null
  score?: number
}

export interface VariantRunRowClient {
  id?: string
  created_at?: string
  engine_version: string
  filter_variant: string
  ticker: string
  timeframe: string
  signals_generated: number | null
  trades_executed: number | null
  win_rate: number | null
  avg_rr: number | null
  expectancy: number | null
  total_return_pct: number | null
  max_drawdown_pct: number | null
  profit_factor: number | null
  test_period_days: number | null
  notes?: string | null
}

interface Props {
  aggregates: VariantAggregateRowClient[]
  ranked: VariantAggregateRowClient[]
  runs: VariantRunRowClient[]
}

export function VariantDashboardClient({ aggregates, ranked, runs }: Props) {
  const [selectedVariant, setSelectedVariant] = useState<string | null>(
    ranked[0]?.filter_variant ?? null,
  )
  const [metric, setMetric] = useState<'expectancy' | 'total_return_pct'>('expectancy')
  const [engineFilter, setEngineFilter] = useState<string | 'all'>('all')
  const [detailOpen, setDetailOpen] = useState(false)

  const filteredRanked = useMemo(
    () =>
      ranked.filter((v) =>
        engineFilter === 'all' ? true : v.engine_version === engineFilter,
      ),
    [ranked, engineFilter],
  )

  const topThree = filteredRanked.slice(0, 3)

  const selectedAggregate = useMemo(
    () =>
      aggregates.find((v) => v.filter_variant === selectedVariant) ?? null,
    [aggregates, selectedVariant],
  )

  const engineVersions = Array.from(
    new Set(aggregates.map((v) => v.engine_version)),
  )

  return (
    <div className="space-y-8">
      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-slate-300">
            Engine Version
          </span>
          <Button
            size="sm"
            variant={engineFilter === 'all' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => setEngineFilter('all')}
          >
            All
          </Button>
          {engineVersions.map((ev) => (
            <Button
              key={ev}
              size="sm"
              variant={engineFilter === ev ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => setEngineFilter(ev)}
            >
              {ev}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-slate-300">
            Heatmap metric
          </span>
          <Button
            size="sm"
            variant={metric === 'expectancy' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => setMetric('expectancy')}
          >
            Expectancy
          </Button>
          <Button
            size="sm"
            variant={metric === 'total_return_pct' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => setMetric('total_return_pct')}
          >
            Total return
          </Button>
        </div>
      </div>

      {/* Top 3 variant score cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {topThree.map((variant, idx) => (
          <VariantScoreCard
            key={variant.filter_variant}
            variant={variant}
            rank={idx + 1}
            onSelect={() => {
              setSelectedVariant(variant.filter_variant)
              setDetailOpen(true)
            }}
          />
        ))}
      </div>

      <Tabs defaultValue="heatmap" className="space-y-6">
        <TabsList>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>
        <TabsContent value="heatmap" className="space-y-4">
          <VariantHeatmap
            rows={runs}
            metric={metric}
            selectedVariant={selectedVariant}
            onSelectVariant={setSelectedVariant}
          />
        </TabsContent>
        <TabsContent value="table" className="space-y-4">
          <VariantTable
            variants={filteredRanked}
            onSelectVariant={(v) => {
              setSelectedVariant(v)
              setDetailOpen(true)
            }}
          />
        </TabsContent>
      </Tabs>

      <VariantDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        variantKey={selectedVariant}
        aggregate={selectedAggregate}
        runs={runs}
      />
    </div>
  )
}
