'use client'

import { useEffect, useState } from 'react'
import { NyTimeBadge } from '@/components/admin/NyTimeBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
  todays_live_pnl?: number
  unrealized_pnl?: number
  avg_r: number
  max_drawdown: number
  current_equity: number
  net_return: number
  equity_curve: Array<{ timestamp: string; equity: number }>
  recent_trades?: any[]
  display_label?: string
  engine_params?: {
    brakes?: {
      enabled?: boolean
      soft_enabled?: boolean
      soft_lock_pnl?: number
      hard_lock_pnl?: number
      max_daily_loss?: number
      max_trades_per_day?: number
      throttle_factor?: number
    }
  }
}

interface EngineDailyState {
  engine_key: string
  engine_version: string
  trading_day: string
  state: string
  daily_pnl: number
  trades_count: number
  throttle_factor: number
  halt_reason: string | null
  updated_at: string
}

export default function ShadowBrakesV1Page() {
  const [engine, setEngine] = useState<EngineMetric | null>(null)
  const [dailyState, setDailyState] = useState<EngineDailyState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const metricsResp = await fetch('/api/admin/engine-metrics')
        if (!metricsResp.ok) throw new Error('Failed to fetch metrics')
        const metricsJson = await metricsResp.json()

        const shadowEngines = (metricsJson.metrics || []).filter(
          (m: EngineMetric) => m.run_mode === 'SHADOW' && m.engine_version === 'SHADOW_BRAKES_V1',
        )

        if (shadowEngines.length === 0) {
          throw new Error('SHADOW_BRAKES_V1 engine not found')
        }

        const engineMetric = shadowEngines[0]
        setEngine(engineMetric)

        const stateResp = await fetch(
          `/api/admin/engine-daily-state?engine_key=${encodeURIComponent(
            engineMetric.engine_key,
          )}&engine_version=${encodeURIComponent(engineMetric.engine_version)}`,
        )
        if (stateResp.ok) {
          const stateJson = await stateResp.json()
          setDailyState(stateJson.state ?? null)
        }
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
          <h1 className="text-3xl font-bold">Shadow • Brakes V1</h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !engine) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Shadow • Brakes V1</h1>
          <p className="text-red-600 mt-2">Error: {error}</p>
        </div>
      </div>
    )
  }

  const brakes = engine.engine_params?.brakes ?? {}

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground">Shadow • Brakes V1</h1>
            <Badge className={engine.is_enabled ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-gray-200'}>
              {engine.is_enabled ? 'Running' : 'Stopped'}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-2">
            P&amp;L-based brakes shadow engine for SWING, mirroring live behaviour with soft throttle and hard halts.
          </p>
        </div>
        <NyTimeBadge />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Brakes Configuration</CardTitle>
          <CardDescription>Static thresholds loaded from engine_versions.settings.brakes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4 text-sm">
            <Stat label="Soft lock P&amp;L" value={brakes.soft_lock_pnl != null ? `$${brakes.soft_lock_pnl.toFixed(0)}` : '—'} />
            <Stat label="Hard lock P&amp;L" value={brakes.hard_lock_pnl != null ? `$${brakes.hard_lock_pnl.toFixed(0)}` : '—'} />
            <Stat label="Max daily loss" value={brakes.max_daily_loss != null ? `$${brakes.max_daily_loss.toFixed(0)}` : '—'} />
            <Stat label="Max trades / day" value={brakes.max_trades_per_day != null ? String(brakes.max_trades_per_day) : '—'} />
            <Stat label="Throttle factor" value={brakes.throttle_factor != null ? `${(brakes.throttle_factor * 100).toFixed(0)}%` : '—'} />
            <Stat label="Soft brakes" value={brakes.soft_enabled === false ? 'Disabled' : 'Enabled'} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s State</CardTitle>
          <CardDescription>Live brake state as tracked in engine_daily_state</CardDescription>
        </CardHeader>
        <CardContent>
          {dailyState ? (
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4 text-sm">
              <Stat label="Trading day" value={dailyState.trading_day} />
              <Stat label="State" value={dailyState.state} />
              <Stat
                label="Daily P&amp;L"
                value={`$${dailyState.daily_pnl.toFixed(2)}`}
              />
              <Stat label="Trades count" value={String(dailyState.trades_count)} />
              <Stat
                label="Throttle factor"
                value={dailyState.throttle_factor != null ? `${(dailyState.throttle_factor * 100).toFixed(0)}%` : '—'}
              />
              <Stat label="Halt reason" value={dailyState.halt_reason || '—'} />
              <Stat
                label="Last updated"
                value={new Date(dailyState.updated_at).toLocaleString()}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No engine_daily_state row found for today yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>High-level performance snapshot</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4 text-sm">
            <Stat label="Win rate" value={`${engine.win_rate.toFixed(1)}%`} />
            <Stat
              label="Avg R"
              value={`${engine.avg_r.toFixed(2)}R`}
            />
            <Stat
              label="Total P&amp;L"
              value={`$${engine.total_pnl.toFixed(0)}`}
            />
            <Stat
              label="Current equity"
              value={`$${engine.current_equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1 break-words">{value}</p>
    </div>
  )
}