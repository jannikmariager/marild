'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { VariantAggregateRowClient, VariantRunRowClient } from './VariantDashboardClient'
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  variantKey: string | null
  aggregate: VariantAggregateRowClient | null
  runs: VariantRunRowClient[]
}

export function VariantDetailModal({ open, onOpenChange, variantKey, aggregate, runs }: Props) {
  if (!variantKey) {
    return null
  }

  const variantRuns = runs.filter((r) => r.filter_variant === variantKey)

  const byTicker = new Map<string, VariantRunRowClient[]>()
  variantRuns.forEach((r) => {
    const list = byTicker.get(r.ticker) ?? []
    list.push(r)
    byTicker.set(r.ticker, list)
  })

  const tickerStats = Array.from(byTicker.entries()).map(([ticker, items]) => {
    const avgExp =
      items.length > 0
        ? items.reduce((s, r) => s + (r.expectancy ?? 0), 0) / items.length
        : 0
    const avgRet =
      items.length > 0
        ? items.reduce((s, r) => s + (r.total_return_pct ?? 0), 0) / items.length
        : 0
    const avgDD =
      items.length > 0
        ? items.reduce((s, r) => s + (r.max_drawdown_pct ?? 0), 0) / items.length
        : 0
    const trades = items.reduce((s, r) => s + (r.trades_executed ?? 0), 0)
    return { ticker, avgExp, avgRet, avgDD, trades }
  })

  const best = tickerStats.reduce<null | (typeof tickerStats)[number]>((best, cur) => {
    if (!best) return cur
    return cur.avgExp > best.avgExp ? cur : best
  }, null)

  const worst = tickerStats.reduce<null | (typeof tickerStats)[number]>((worst, cur) => {
    if (!worst) return cur
    return cur.avgExp < worst.avgExp ? cur : worst
  }, null)

  const dd = aggregate?.avg_drawdown ?? 0
  const stability = Math.max(0, 1 - dd / 100) * 100

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-2xl bg-white text-slate-900 border-slate-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <span>{variantKey}</span>
            {aggregate?.engine_version && (
              <Badge variant="outline" className="rounded-full text-[11px] border-slate-300 text-slate-700">
                {aggregate.engine_version}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Detailed breakdown across tickers, timeframes, and risk metrics.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 max-h-[480px] overflow-y-auto space-y-6 pr-2">
          {/* Summary row */}
          <div className="grid gap-4 md:grid-cols-4 text-xs">
            <div className="rounded-2xl bg-emerald-50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                <TrendingUp className="h-3 w-3" /> Avg win rate
              </div>
              <div className="mt-1 text-lg font-semibold text-emerald-700">
                {(((aggregate?.avg_win_rate ?? 0) * 100) || 0).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                <BarChart3 className="h-3 w-3" /> Expectancy
              </div>
              <div className="mt-1 text-lg font-semibold text-emerald-700">
                {(aggregate?.avg_expectancy ?? 0).toFixed(3)} R
              </div>
            </div>
            <div className="rounded-2xl bg-red-50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-red-700">
                <TrendingDown className="h-3 w-3" /> Avg drawdown
              </div>
              <div className="mt-1 text-lg font-semibold text-red-700">
                {(aggregate?.avg_drawdown ?? 0).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-2xl bg-yellow-50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-yellow-700">
                Stability score
              </div>
              <div className="mt-1 text-lg font-semibold text-yellow-700">
                {stability.toFixed(1)} / 100
              </div>
            </div>
          </div>

          {/* Best / worst tickers */}
          <div className="grid gap-4 md:grid-cols-2 text-xs">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-emerald-700">
                <span>Best ticker</span>
                {best && <span>{best.ticker}</span>}
              </div>
              {best ? (
                <p className="text-[11px] text-slate-700">
                  Expectancy {(best.avgExp ?? 0).toFixed(3)} R, return {(best.avgRet ?? 0).toFixed(1)}%,
                  drawdown {(best.avgDD ?? 0).toFixed(1)}%, trades {best.trades}.
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">No data yet.</p>
              )}
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-red-700">
                <span>Worst ticker</span>
                {worst && <span>{worst.ticker}</span>}
              </div>
              {worst ? (
                <p className="text-[11px] text-slate-700">
                  Expectancy {(worst.avgExp ?? 0).toFixed(3)} R, return {(worst.avgRet ?? 0).toFixed(1)}%,
                  drawdown {(worst.avgDD ?? 0).toFixed(1)}%, trades {worst.trades}.
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">No data yet.</p>
              )}
            </div>
          </div>

          {/* Raw runs table */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">All runs ({variantRuns.length})</span>
              <span className="text-[11px] text-slate-500">
                Grouped by ticker and timeframe
              </span>
            </div>
            <style jsx>{`
              .modal-table-scroll::-webkit-scrollbar {
                width: 12px;
                height: 12px;
              }
              .modal-table-scroll::-webkit-scrollbar-track {
                background: #f1f5f9;
                border-radius: 8px;
              }
              .modal-table-scroll::-webkit-scrollbar-thumb {
                background: #94a3b8;
                border-radius: 8px;
              }
              .modal-table-scroll::-webkit-scrollbar-thumb:hover {
                background: #64748b;
              }
            `}</style>
            <div 
              className="modal-table-scroll overflow-auto rounded-2xl border border-slate-200 bg-white"
              style={{
                maxHeight: '400px',
                scrollbarWidth: 'thin',
                scrollbarColor: '#94a3b8 #f1f5f9'
              }}
            >
              <table className="min-w-full border-collapse text-[11px] text-slate-900">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-2 py-2 text-left">Ticker</th>
                    <th className="px-2 py-2 text-left">TF</th>
                    <th className="px-2 py-2 text-right">Signals</th>
                    <th className="px-2 py-2 text-right">Trades</th>
                    <th className="px-2 py-2 text-right">Win %</th>
                    <th className="px-2 py-2 text-right">Expectancy</th>
                    <th className="px-2 py-2 text-right">Avg RR</th>
                    <th className="px-2 py-2 text-right">Return %</th>
                    <th className="px-2 py-2 text-right">DD %</th>
                    <th className="px-2 py-2 text-right">Profit Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {variantRuns.map((r) => (
                    <tr
                      key={`${r.ticker}-${r.timeframe}-${r.id ?? r.created_at}`}
                      className="border-b border-slate-200"
                    >
                      <td className="px-2 py-1">{r.ticker}</td>
                      <td className="px-2 py-1">{r.timeframe}</td>
                      <td className="px-2 py-1 text-right">{r.signals_generated ?? 0}</td>
                      <td className="px-2 py-1 text-right">{r.trades_executed ?? 0}</td>
                      <td className="px-2 py-1 text-right">
                        {(((r.win_rate ?? 0) * 100) || 0).toFixed(1)}%
                      </td>
                      <td className="px-2 py-1 text-right">{(r.expectancy ?? 0).toFixed(3)}</td>
                      <td className="px-2 py-1 text-right">{(r.avg_rr ?? 0).toFixed(3)}</td>
                      <td className="px-2 py-1 text-right">
                        {(r.total_return_pct ?? 0).toFixed(1)}%
                      </td>
                      <td className="px-2 py-1 text-right">
                        {(r.max_drawdown_pct ?? 0).toFixed(1)}%
                      </td>
                      <td className="px-2 py-1 text-right">
                        {(r.profit_factor ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}