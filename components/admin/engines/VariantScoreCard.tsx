'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react'
import type { VariantAggregateRowClient } from './VariantDashboardClient'
import { cn } from '@/lib/utils'

interface Props {
  variant: VariantAggregateRowClient
  rank: number
  onSelect?: () => void
}

export function VariantScoreCard({ variant, rank, onSelect }: Props) {
  const score = variant.score ?? 0
  const win = (variant.avg_win_rate ?? 0) * 100
  const exp = variant.avg_expectancy ?? 0
  const dd = variant.avg_drawdown ?? 0

  const positive = exp > 0 && dd < 25

  return (
    <Card
      className={cn(
        'group cursor-pointer rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm transition hover:border-emerald-300 hover:shadow-md',
      )}
      onClick={onSelect}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">
              #{rank}
            </span>
            <span>{variant.filter_variant}</span>
          </CardTitle>
          <CardDescription className="flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] uppercase tracking-wide text-emerald-700">
              {variant.engine_version}
            </span>
            <span>Global V7.x filter preset</span>
          </CardDescription>
        </div>
        <Badge
          variant="outline"
          className="rounded-full border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-700"
        >
          Score {score.toFixed(2)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-emerald-600">
            {score.toFixed(2)}
          </span>
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Composite score
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="flex flex-col gap-1 rounded-2xl bg-slate-50 p-3">
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <TrendingUp className="h-3 w-3 text-emerald-500" /> Win rate
            </div>
            <div className="text-sm font-semibold text-slate-900">{win.toFixed(1)}%</div>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl bg-slate-50 p-3">
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <BarChart3 className="h-3 w-3 text-emerald-500" /> Expectancy
            </div>
            <div className="text-sm font-semibold text-slate-900">{exp.toFixed(3)} R</div>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl bg-slate-50 p-3">
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <TrendingDown className="h-3 w-3 text-red-500" /> Drawdown
            </div>
            <div className={cn('text-sm font-semibold', dd > 25 ? 'text-red-600' : 'text-slate-900')}>
              {dd.toFixed(1)}%
            </div>
          </div>
        </div>
        <p className="text-[11px] text-slate-600">
          {positive
            ? 'Strong risk-adjusted performance with controlled drawdowns.'
            : 'Mixed performance – inspect underlying runs before promoting to default.'}
        </p>
      </CardContent>
    </Card>
  )
}
