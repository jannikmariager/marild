'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface EngineTrade {
  ticker: string | null
  side: 'LONG' | 'SHORT' | null
  entry_price: number | null
  exit_price: number | null
  entry_timestamp: string | null
  exit_timestamp: string | null
  realized_pnl_dollars: number | null
  realized_pnl_r: number | null
}

interface EngineMetric {
  engine_version: string
  run_mode: 'PRIMARY' | 'SHADOW'
  is_enabled: boolean
  is_user_visible: boolean
  started_at: string | null
  stopped_at: string | null
  total_trades: number
  winners: number
  losers: number
  win_rate: number
  total_pnl: number
  todays_pnl?: number
  todays_live_pnl?: number
  unrealized_pnl?: number
  avg_r: number
  max_drawdown: number
  current_equity: number
  net_return: number
  equity_curve: Array<{ timestamp: string; equity: number }>
  recent_trades?: EngineTrade[]
  display_label?: string
}

interface JournalTotals {
  starting_equity: number
  current_equity: number
  since_inception_realized_pnl: number
  current_unrealized_pnl: number
  net_return_pct: number
}

interface HeartbeatResult {
  name: string
  ok: boolean
  details?: string
}

interface HeartbeatStatus {
  ok: boolean
  results: HeartbeatResult[]
  error?: string
}

type EngineMetricWithKey = EngineMetric & { engine_key?: string | null }

const HIDDEN_SHADOW_VERSIONS = new Set(['SWING_V1_12_15DEC', 'SWING_FAV8_SHADOW'])

const getShadowSlug = (engine: EngineMetricWithKey) => {
  const engineKey = (engine.engine_key || '').toUpperCase()
  const version = (engine.engine_version || '').toUpperCase()
  if (engineKey === 'CRYPTO_V1_SHADOW' || version === 'CRYPTO_V1_SHADOW' || version === 'V1') {
    return 'crypto-v1-shadow'
  }
  if (version === 'QUICK_PROFIT_V1' || version === 'SCALP_V1_MICROEDGE') {
    return 'quick-profit'
  }
  return version.toLowerCase().replace(/_/g, '-')
}

export default function EngineMetricsPage() {
  const [metrics, setMetrics] = useState<EngineMetric[]>([])
  const [journalTotals, setJournalTotals] = useState<JournalTotals | null>(null)
  const [heartbeat, setHeartbeat] = useState<HeartbeatStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const response = await fetch('/api/admin/engine-metrics')
        if (!response.ok) {
          throw new Error('Failed to fetch metrics')
        }
        const data = await response.json()
        setMetrics(data.metrics || [])
        setJournalTotals(data.journal_totals || null)
        setHeartbeat(data.heartbeat || null)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    fetchMetrics()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Engine Performance</h1>
          <p className="text-muted-foreground mt-2">Loading metrics...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Engine Performance</h1>
          <p className="text-red-600 mt-2">Error: {error}</p>
        </div>
      </div>
    )
  }

  const primaryEngines = metrics.filter((m) => m.run_mode === 'PRIMARY')
  const shadowEngines = metrics.filter((m) => m.run_mode === 'SHADOW')
  const activePrimary = primaryEngines.find((engine) => engine.is_enabled) ?? primaryEngines[0] ?? null

  const getEngineLabel = (engine: EngineMetric) => engine.display_label || engine.engine_version
  const heartbeatFailures = heartbeat?.results?.filter((r) => !r.ok) ?? []
  const visibleShadowEngines = shadowEngines.filter(
    (engine) => !HIDDEN_SHADOW_VERSIONS.has((engine.engine_version || '').toUpperCase()),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Engine Performance</h1>
        <p className="text-muted-foreground mt-2">
          Compare live (PRIMARY) and shadow (SHADOW) engine versions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Routing Flow (cheatsheet)</CardTitle>
          <CardDescription>End-to-end path from focus build to execution</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li>
              Pre-market Focus V2:
              <ul className="list-disc list-inside ml-4 space-y-0.5">
                <li>Primary lane: confidence ≥ <span className="font-semibold">FOCUS_PRIMARY_MIN_CONFIDENCE</span> (default 55).</li>
                <li>Momentum lane: confidence 48–54 + volatility gate (list/ATR hybrid) for momentum names.</li>
                <li>Fallback fill up to <span className="font-semibold">MIN_FOCUS_SIZE</span>; overall cap <span className="font-semibold">FOCUS_MAX_TICKERS</span>. If still too small, engines scan full universe as before.</li>
                <li>Writes <span className="font-semibold">daily_focus_tickers</span> (ordered primary → momentum → fallback) and optional audit rows.</li>
              </ul>
            </li>
            <li>Signal generators (SWING/others) fetch focus list + market data (or full universe if focus too small); trade gate must be open; write <span className="font-semibold">ai_signals</span>.</li>
            <li><span className="font-semibold">model_portfolio_manager</span> loads signals → filters to focus list (SWING) → applies trade gate.</li>
            <li>If <span className="font-semibold">engine_allocation_enabled</span> AND symbol in allowlist → lookup <span className="font-semibold">ticker_engine_owner</span> to choose engine_key/version; else fallback to SWING/BASELINE.</li>
            <li>Executes live sizing/entries; stores engine_key/version + publish flags on <span className="font-semibold">live_positions</span>/<span className="font-semibold">live_trades</span>/<span className="font-semibold">decision log</span>.</li>
            <li>Daily job <span className="font-semibold">engine_allocation_scoring</span> scores shadow trades and may update <span className="font-semibold">ticker_engine_owner</span> (respecting allowlist, cooldown, no open live position).</li>
            <li>Admin controls: feature flag & allowlist in <span className="font-semibold">app_feature_flags</span>; manual owner overrides update <span className="font-semibold">ticker_engine_owner</span>.</li>
          </ol>
        </CardContent>
      </Card>
      <Card className={heartbeat?.ok ? 'border-emerald-200' : 'border-red-200'}>
        <CardHeader>
          <CardTitle>System Heartbeat</CardTitle>
          <CardDescription>
            Live diagnostics from the <code>system_heartbeat</code> edge function. Updates whenever cron jobs run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!heartbeat ? (
            <p className="text-muted-foreground">No heartbeat data available.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium">
                {heartbeat.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                )}
                <span className={heartbeat.ok ? 'text-emerald-700' : 'text-red-700'}>
                  {heartbeat.ok
                    ? 'All monitored subsystems reporting healthy'
                    : `${heartbeatFailures.length} check${heartbeatFailures.length === 1 ? '' : 's'} failing`}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {heartbeat.results?.map((result) => (
                  <div
                    key={result.name}
                    className={`rounded-md border p-3 text-sm ${
                      result.ok ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'
                    }`}
                  >
                    <div className="font-semibold">{result.name.replace(/_/g, ' ')}</div>
                    <div className="text-xs text-muted-foreground">
                      {result.ok ? 'OK' : 'Requires attention'}
                      {result.details ? ` — ${result.details}` : ''}
                    </div>
                  </div>
                ))}
              </div>
              {heartbeat.error && (
                <p className="text-xs text-red-600">Heartbeat error: {heartbeat.error}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* PRIMARY Engines */}
      <Card>
        <CardHeader>
          <CardTitle>Live Engines (PRIMARY)</CardTitle>
          <CardDescription>Engines running in production and executing real trades</CardDescription>
        </CardHeader>
        <CardContent>
          {primaryEngines.length === 0 ? (
            <p className="text-muted-foreground">No primary engines found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>Avg R</TableHead>
                  <TableHead>Today&apos;s PnL</TableHead>
                  <TableHead>Unrealized PnL</TableHead>
                  <TableHead>Net Return</TableHead>
                  <TableHead>Max DD</TableHead>
                  <TableHead>Current Equity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {primaryEngines.map((engine) => (
                  <TableRow key={engine.engine_version}>
                    <TableCell className="font-medium">{getEngineLabel(engine)}</TableCell>

                    <TableCell>
                      {engine.is_enabled ? (
                        <Badge variant="default" className="bg-green-600">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {engine.total_trades} ({engine.winners}W / {engine.losers}L)
                    </TableCell>
                    <TableCell>{engine.win_rate.toFixed(1)}%</TableCell>
                    <TableCell className={engine.avg_r >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {engine.avg_r.toFixed(2)}R
                    </TableCell>
                    <TableCell className={(engine.todays_pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                      ${ (engine.todays_pnl ?? 0).toFixed(2) }
                    </TableCell>
                    <TableCell className={(engine.unrealized_pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                      ${ (engine.unrealized_pnl ?? 0).toFixed(2) }
                    </TableCell>
                    <TableCell className={engine.net_return >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {engine.net_return.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-red-600">-{engine.max_drawdown.toFixed(2)}%</TableCell>
                    <TableCell>${engine.current_equity.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* SHADOW Engines */}
      <Card>
        <CardHeader>
          <CardTitle>Shadow Engines (SHADOW)</CardTitle>
          <CardDescription>
            Virtual engines running in parallel with live trading, testing new strategies
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visibleShadowEngines.length === 0 ? (
            <p className="text-muted-foreground">No shadow engines found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>Avg R</TableHead>
                  <TableHead>Today&apos;s PnL</TableHead>
                  <TableHead>Unrealized PnL</TableHead>
                  <TableHead>Net Return</TableHead>
                  <TableHead>Max DD</TableHead>
                  <TableHead>Current Equity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleShadowEngines.map((engineObj) => {
                  const engine = engineObj as EngineMetricWithKey
                  const engineSlug = getShadowSlug(engine)
                  return (
                    <TableRow key={`${engine.engine_key ?? 'SWING'}-${engine.engine_version}`}>
                      <TableCell className="font-medium">
                        <Link href={`/admin/engine-metrics/${engineSlug}`} className="hover:underline text-blue-600">
                          {getEngineLabel(engine)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {engine.is_enabled ? (
                          <Badge variant="outline" className="border-emerald-600 text-emerald-600">
                            Running
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Stopped</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {engine.total_trades} ({engine.winners}W / {engine.losers}L)
                      </TableCell>
                      <TableCell>{engine.win_rate.toFixed(1)}%</TableCell>
                      <TableCell className={engine.avg_r >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {engine.avg_r.toFixed(2)}R
                      </TableCell>
                      <TableCell className={(engine.todays_pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                        ${ (engine.todays_pnl ?? 0).toFixed(2) }
                      </TableCell>
                      <TableCell className={(engine.unrealized_pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                        ${ (engine.unrealized_pnl ?? 0).toFixed(2) }
                      </TableCell>
                      <TableCell className={engine.net_return >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {engine.net_return.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-red-600">-{engine.max_drawdown.toFixed(2)}%</TableCell>
                      <TableCell>${engine.current_equity.toLocaleString()}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {journalTotals && activePrimary && (
        <Card>
          <CardHeader>
            <CardTitle>Live Journal vs Admin (SWING)</CardTitle>
            <CardDescription>
              Journal stats include every SWING trade (any engine version) plus current unrealized PnL. Admin stats on
              this page are scoped to the active engine_version ({getEngineLabel(activePrimary)}). Any delta therefore
              represents historical trades or open positions outside the current engine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Admin (Primary Engine)</TableHead>
                  <TableHead>Journal (Strategy)</TableHead>
                  <TableHead>Delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Current Equity</TableCell>
                  <TableCell>
                    ${activePrimary.current_equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    ${journalTotals.current_equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    ${(activePrimary.current_equity - journalTotals.current_equity).toFixed(2)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Net Return %</TableCell>
                  <TableCell>{activePrimary.net_return.toFixed(2)}%</TableCell>
                  <TableCell>{journalTotals.net_return_pct.toFixed(2)}%</TableCell>
                  <TableCell>
                    {(activePrimary.net_return - journalTotals.net_return_pct).toFixed(2)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Total Realized PnL</TableCell>
                  <TableCell>${activePrimary.total_pnl.toFixed(2)}</TableCell>
                  <TableCell>${journalTotals.since_inception_realized_pnl.toFixed(2)}</TableCell>
                  <TableCell>
                    {(activePrimary.total_pnl - journalTotals.since_inception_realized_pnl).toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Info Banner */}
      <Card className="border-l-4 border-l-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">View Shadow Engine Details</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Click on any shadow engine name above to view its detailed configuration, parameters, and complete trade history.
        </CardContent>
      </Card>
    </div>
  )
}
