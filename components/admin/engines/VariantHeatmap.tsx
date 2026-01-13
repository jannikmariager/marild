'use client'

import type { VariantRunRowClient } from './VariantDashboardClient'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Props {
  rows: VariantRunRowClient[]
  metric: 'expectancy' | 'total_return_pct'
  selectedVariant: string | null
  onSelectVariant?: (variant: string | null) => void
}

export function VariantHeatmap({ rows, metric, selectedVariant, onSelectVariant }: Props) {
  const variants = Array.from(new Set(rows.map((r) => r.filter_variant))).sort()
  const tickers = Array.from(new Set(rows.map((r) => r.ticker))).sort()
  const timeframes = Array.from(new Set(rows.map((r) => r.timeframe))).sort()

  const activeVariant = selectedVariant ?? variants[0] ?? null

  const filtered = rows.filter((r) => r.filter_variant === activeVariant)

  const valueByKey = new Map<string, number | null>()
  filtered.forEach((r) => {
    const key = `${r.ticker}|${r.timeframe}`
    const val = metric === 'expectancy' ? r.expectancy : r.total_return_pct
    valueByKey.set(key, val ?? null)
  })

  const values = Array.from(valueByKey.values()).filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  )
  const max = values.length ? Math.max(...values) : 0
  const min = values.length ? Math.min(...values) : 0

  const classify = (v: number | null | undefined): string => {
    if (v == null || Number.isNaN(v)) return 'bg-slate-100 text-slate-400'
    if (metric === 'expectancy') {
      if (v >= 0.15) return 'bg-green-100 text-green-800'
      if (v >= 0.05) return 'bg-yellow-100 text-yellow-800'
      if (v <= -0.05) return 'bg-red-100 text-red-800'
      return 'bg-yellow-100 text-yellow-800'
    }
    if (v >= 30) return 'bg-green-100 text-green-800'
    if (v >= 10) return 'bg-yellow-100 text-yellow-800'
    if (v <= -10) return 'bg-red-100 text-red-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  return (
    <Card className="rounded-2xl shadow-md bg-white border-slate-200">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base text-slate-900">Variant Heatmap</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            {metric === 'expectancy'
              ? 'Expectancy (R per trade) across tickers and timeframes.'
              : 'Total return (%) across tickers and timeframes.'}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600">Variant</span>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <Badge
                key={v}
                variant={v === activeVariant ? 'default' : 'outline'}
                className="cursor-pointer rounded-full"
                onClick={() => onSelectVariant?.(v)}
              >
                {v}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeVariant == null || tickers.length === 0 ? (
          <p className="text-sm text-slate-500">No data available yet.</p>
        ) : (
          <div className="space-y-3">
            <style jsx>{`
              .heatmap-scroll::-webkit-scrollbar {
                width: 12px;
                height: 12px;
              }
              .heatmap-scroll::-webkit-scrollbar-track {
                background: #f1f5f9;
                border-radius: 8px;
              }
              .heatmap-scroll::-webkit-scrollbar-thumb {
                background: #94a3b8;
                border-radius: 8px;
              }
              .heatmap-scroll::-webkit-scrollbar-thumb:hover {
                background: #64748b;
              }
            `}</style>
            <div 
              className="heatmap-scroll overflow-auto rounded-2xl border border-slate-200 bg-white p-3"
              style={{
                maxHeight: '600px',
                scrollbarWidth: 'thin',
                scrollbarColor: '#94a3b8 #f1f5f9'
              }}
            >
              <table className="min-w-full border-collapse text-xs text-slate-900">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left text-[11px] text-slate-600 font-semibold">Ticker / TF</th>
                    {timeframes.map((tf) => (
                      <th
                        key={tf}
                        className="px-2 py-1 text-center text-[11px] font-semibold text-slate-600"
                      >
                        {tf}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickers.map((ticker) => (
                    <tr key={ticker} className="border-t border-slate-200">
                      <td className="px-2 py-1 text-[11px] font-semibold text-slate-700">
                        {ticker}
                      </td>
                      {timeframes.map((tf) => {
                        const key = `${ticker}|${tf}`
                        const v = valueByKey.get(key) ?? null
                        const cls = classify(v)
                        return (
                          <td
                            key={key}
                            className="px-1 py-1 text-center align-middle"
                            title={
                              v == null
                                ? 'No data'
                                : metric === 'expectancy'
                                ? `${v.toFixed(3)} R`
                                : `${v.toFixed(1)}%`
                            }
                          >
                            <div
                              className={`flex h-8 items-center justify-center rounded-xl text-[11px] font-semibold ${cls}`}
                            >
                              {v == null
                                ? '–'
                                : metric === 'expectancy'
                                ? v.toFixed(2)
                                : v.toFixed(1)}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span>
                Active variant: <span className="font-semibold text-slate-900">{activeVariant}</span>
              </span>
              <span>
                Range: {min.toFixed(2)} – {max.toFixed(2)} {metric === 'expectancy' ? 'R' : '%'}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
