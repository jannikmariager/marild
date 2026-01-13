'use client'

import { useMemo, useState } from 'react'
import type { VariantAggregateRowClient } from './VariantDashboardClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUpDown } from 'lucide-react'

interface Props {
  variants: VariantAggregateRowClient[]
  onSelectVariant?: (variantKey: string) => void
}

type SortKey =
  | 'filter_variant'
  | 'avg_win_rate'
  | 'avg_expectancy'
  | 'avg_avg_rr'
  | 'avg_total_return'
  | 'avg_drawdown'
  | 'avg_profit_factor'
  | 'trades_per_ticker'
  | 'score'

export function VariantTable({ variants, onSelectVariant }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const list = [...variants]
    list.sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0
      const bv = (b as any)[sortKey] ?? 0
      if (av === bv) return 0
      const res = av > bv ? 1 : -1
      return sortDir === 'asc' ? res : -res
    })
    return list
  }, [variants, sortKey, sortDir])

  const changeSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'filter_variant' ? 'asc' : 'desc')
    }
  }

  const headerButton = (label: string, key: SortKey) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-xs font-medium"
      onClick={() => changeSort(key)}
    >
      <span>{label}</span>
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )

  return (
    <Card className="rounded-2xl shadow-md bg-slate-900/80 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-slate-50">Variant Ranking</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs text-slate-100">
          <thead>
            <tr className="border-b border-slate-800 text-left">
              <th className="px-2 py-2">{headerButton('Variant', 'filter_variant')}</th>
              <th className="px-2 py-2">{headerButton('Win %', 'avg_win_rate')}</th>
              <th className="px-2 py-2">{headerButton('Expectancy', 'avg_expectancy')}</th>
              <th className="px-2 py-2">{headerButton('Avg RR', 'avg_avg_rr')}</th>
              <th className="px-2 py-2">{headerButton('Total Ret', 'avg_total_return')}</th>
              <th className="px-2 py-2">{headerButton('Drawdown', 'avg_drawdown')}</th>
              <th className="px-2 py-2">{headerButton('PF', 'avg_profit_factor')}</th>
              <th className="px-2 py-2">{headerButton('Trades', 'trades_per_ticker')}</th>
              <th className="px-2 py-2">{headerButton('Score', 'score')}</th>
              <th className="px-2 py-2 text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((v) => {
              const win = (v.avg_win_rate ?? 0) * 100
              return (
                <tr key={v.filter_variant} className="border-b border-slate-800/60">
                  <td className="px-2 py-2 text-[11px] font-medium text-slate-50">{v.filter_variant}</td>
                  <td className="px-2 py-2 text-[11px]">{win.toFixed(1)}%</td>
                  <td className="px-2 py-2 text-[11px]">{(v.avg_expectancy ?? 0).toFixed(3)}</td>
                  <td className="px-2 py-2 text-[11px]">{(v.avg_avg_rr ?? 0).toFixed(3)}</td>
                  <td className="px-2 py-2 text-[11px]">{(v.avg_total_return ?? 0).toFixed(1)}%</td>
                  <td className="px-2 py-2 text-[11px]">{(v.avg_drawdown ?? 0).toFixed(1)}%</td>
                  <td className="px-2 py-2 text-[11px]">{(v.avg_profit_factor ?? 0).toFixed(2)}</td>
                  <td className="px-2 py-2 text-[11px]">{(v.trades_per_ticker ?? 0).toFixed(1)}</td>
                  <td className="px-2 py-2 text-[11px] font-semibold">{(v.score ?? 0).toFixed(2)}</td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full text-[11px]"
                      onClick={() => onSelectVariant?.(v.filter_variant)}
                    >
                      Details
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}