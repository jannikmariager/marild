'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import EquityCurveChart from '@/components/admin/performance/EquityCurveChart'

interface EngineTrade {
  ticker: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  entry_timestamp: string | null
  exit_timestamp: string | null
  realized_pnl_dollars: number | null
  realized_pnl_r: number | null
}

interface EngineMetric {
  engine_version: string
  engine_key: string
  run_mode: 'PRIMARY' | 'SHADOW'
  is_enabled: boolean
  total_trades: number
  winners: number
  losers: number
  win_rate: number
  total_pnl: number
  todays_pnl?: number
  avg_r: number
  max_drawdown: number
  current_equity: number
  net_return: number
  equity_curve: Array<{ timestamp: string; equity: number }>
  recent_trades?: EngineTrade[]
  display_label?: string
}

export default function CryptoShadowPage() {
  const [engine, setEngine] = useState<EngineMetric | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/admin/engine-metrics')
        if (!response.ok) throw new Error('Failed to fetch metrics')
        const data = await response.json()

        const shadowEngines = (data.metrics || []).filter((m: EngineMetric) => {
          const ev = (m.engine_version || '').toUpperCase()
          const ek = (m.engine_key || '').toUpperCase()
          return (
            m.run_mode === 'SHADOW' &&
            (ek === 'CRYPTO_V1_SHADOW' || ev === 'CRYPTO_V1_SHADOW' || ev === 'V1')
          )
        })

        if (shadowEngines.length === 0) {
          throw new Error('Crypto shadow engine not found')
        }

        setEngine(shadowEngines[0])
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Engine Metrics</h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !engine) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Engine Metrics</h1>
          <p className="text-red-600 mt-2">Error: {error}</p>
        </div>
      </div>
    )
  }

  const recentTrades = (engine.recent_trades || []).slice(0, 50)
  const equityPoints = engine.equity_curve.map((p) => ({ ts: p.timestamp, equity: p.equity }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold">{engine.display_label || 'Crypto V1 (Shadow)'}</h1>
          <p className="text-muted-foreground mt-1">
            Shadow-only crypto engine tracking BTC/ETH/SOL/ADA/MATIC with 24/7 execution
          </p>
        </div>
        <Badge className={engine.is_enabled ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-gray-200'}>
          {engine.is_enabled ? 'Running' : 'Stopped'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>Performance snapshot</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <Stat label="Current Equity" value={`$${engine.current_equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            <Stat label="Net Return" value={`${engine.net_return.toFixed(2)}%`} />
            <Stat label="Win Rate" value={`${engine.win_rate.toFixed(1)}%`} />
            <Stat label="Avg R" value={`${engine.avg_r.toFixed(2)}R`} />
            <Stat label="Max Drawdown" value={`-${engine.max_drawdown.toFixed(2)}%`} />
            <Stat label="Trades" value={`${engine.total_trades} (${engine.winners}W / ${engine.losers}L)`} />
            <Stat label="Today's PnL" value={`$${(engine.todays_pnl ?? 0).toFixed(2)}`} />
            <Stat label="Total PnL" value={`$${engine.total_pnl.toFixed(2)}`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
          <CardDescription>Latest snapshots</CardDescription>
        </CardHeader>
        <CardContent>
          <EquityCurveChart title="Crypto Shadow Equity" points={equityPoints} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
          <CardDescription>Most recent 50 executions</CardDescription>
        </CardHeader>
        <CardContent>
          {recentTrades.length === 0 ? (
            <p className="text-muted-foreground text-sm">No trades yet.</p>
          ) : (
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Ticker</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">PnL $</TableHead>
                  <TableHead className="text-right">R</TableHead>
                  <TableHead className="text-right">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTrades.map((trade, idx) => {
                  const pnl = Number(trade.realized_pnl_dollars ?? 0)
                  const isWin = pnl >= 0
                  return (
                    <TableRow key={idx} className={isWin ? 'bg-green-50/40' : 'bg-red-50/40'}>
                      <TableCell className="font-semibold">{trade.ticker || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={trade.side === 'SHORT' ? 'secondary' : 'default'} className="text-xs">
                          {trade.side || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {trade.exit_price ? `$${trade.exit_price.toFixed(4)}` : '—'}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${isWin ? 'text-green-700' : 'text-red-700'}`}>
                        {isWin ? '+' : ''}{pnl.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {trade.realized_pnl_r !== null && trade.realized_pnl_r !== undefined
                          ? trade.realized_pnl_r.toFixed(2)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {trade.exit_timestamp ? new Date(trade.exit_timestamp).toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
    </div>
  )
}
