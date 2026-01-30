'use client'

import { useEffect, useState } from 'react'
import { formatNyDateTime } from '@/lib/datetime'
import { RiskRewardBar } from '@/components/performance/RiskRewardBar'

type ContextMetrics = {
  total_trades: number
  trades_won: number
  trades_lost: number
  win_rate_pct: number
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  current_equity: number
  starting_equity: number
}

type RawTrade = {
  id: string
  ticker: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  realized_pnl: number | null
  realized_r: number | null
  opened_at: string | null
  closed_at: string | null
}

type OpenPosition = {
  id: string
  ticker: string | null
  side: string | null
  qty: number | null
  entry_price: number | null
  entry_time: string | null
  stop_loss: number | null
  take_profit: number | null
  notional_at_entry: number | null
  risk_dollars: number | null
  mark_price: number | null
  pnl_dollars: number | null
  pnl_pct: number | null
}

type ClosedPosition = {
  id: string
  ticker: string | null
  side: string | null
  qty: number | null
  entry_price: number | null
  entry_time: string | null
  exit_price: number | null
  exit_time: string | null
  realized_pnl: number | null
  realized_r: number | null
  pnl_pct: number | null
  exit_reason: string | null
}

type PolicySummary = {
  policy_version: string
  as_of: string
  trade_gate: string | null
  risk_scale: number | null
  max_positions_override: number | null
  regime: string | null
  notes: string[] | null
} | null

type LiveEquitySummary = {
  current_equity: number | null
  net_return_pct: number | null
} | null

type ApiResponse = {
  status: string
  metrics: ContextMetrics
  trades: RawTrade[]
  open_positions: OpenPosition[]
  recent_closed_positions: ClosedPosition[]
  policy: PolicySummary
  live_equity: LiveEquitySummary
}

export function SwingContextShadowEngine() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData(true)
    const interval = setInterval(() => fetchData(false), 15000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData(showSpinner: boolean) {
    try {
      if (showSpinner) setIsLoading(true)
      setError(null)
      const res = await fetch('/api/admin/swing-context-shadow-metrics')
      if (!res.ok) throw new Error('Failed to fetch SWING context shadow metrics')
      const json = (await res.json()) as ApiResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      if (showSpinner) setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        <p className="mt-4 text-sm text-gray-600">Loading SWING context shadow metrics…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-6">
        <h3 className="text-sm font-semibold text-red-900">Error</h3>
        <p className="mt-2 text-sm text-red-700">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return <div>No data</div>

  const { metrics, open_positions, recent_closed_positions, policy, live_equity } = data

  const liveEquity = live_equity?.current_equity ?? null
  const liveReturnPct = live_equity?.net_return_pct ?? null

  const shadowReturnPct = metrics.starting_equity
    ? ((metrics.current_equity - metrics.starting_equity) / metrics.starting_equity) * 100
    : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <MetricCard label="Current equity" value={`$${metrics.current_equity.toLocaleString()}`} />
        <MetricCard
          label="Total P&L"
          value={`$${metrics.total_pnl.toFixed(0)}`}
          accent={metrics.total_pnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          label="Realized P&L"
          value={`$${metrics.realized_pnl.toFixed(0)}`}
          accent={metrics.realized_pnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          label="Unrealized P&L"
          value={`$${metrics.unrealized_pnl.toFixed(0)}`}
          accent={metrics.unrealized_pnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard label="Win rate" value={`${metrics.win_rate_pct.toFixed(1)}%`} />
        <MetricCard label="Open positions" value={`${open_positions.length}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-6">
          <h3 className="text-sm font-semibold text-emerald-900 mb-2">Market context policy</h3>
          {policy ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-medium">{policy.policy_version}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">As of</dt>
                <dd className="font-medium">{formatNyDateTime(policy.as_of)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Regime</dt>
                <dd className="font-medium capitalize">{policy.regime ?? 'unknown'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Trade gate</dt>
                <dd
                  className={`font-semibold ${
                    policy.trade_gate === 'CLOSE' ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {policy.trade_gate ?? 'OPEN'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Risk scale</dt>
                <dd className="font-medium">{policy.risk_scale ?? 1}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Max positions override</dt>
                <dd className="font-medium">
                  {policy.max_positions_override != null ? policy.max_positions_override : '—'}
                </dd>
              </div>
              {policy.notes && policy.notes.length > 0 && (
                <div className="pt-2 text-xs text-emerald-900 space-y-0.5">
                  {policy.notes.slice(0, 4).map((note, idx) => (
                    <p key={idx}>• {note}</p>
                  ))}
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No CTX_V1_MINIMAL decision found yet. Shadow engine currently using base SWING config.
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 col-span-1 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Live vs context shadow (since common start)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Shadow net return</div>
              <div
                className={`text-2xl font-semibold ${
                  shadowReturnPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {shadowReturnPct >= 0 ? '+' : ''}
                {shadowReturnPct.toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Live SWING net return</div>
              <div
                className={`text-2xl font-semibold ${
                  (liveReturnPct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {liveReturnPct != null ? `${liveReturnPct >= 0 ? '+' : ''}${liveReturnPct.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Equity (live vs shadow)</div>
              <div className="text-sm font-mono mt-1 space-y-0.5">
                <div>
                  <span className="text-muted-foreground mr-1">Live:</span>
                  {liveEquity != null ? `$${liveEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                </div>
                <div>
                  <span className="text-muted-foreground mr-1">Shadow:</span>
                  {`$${metrics.current_equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <OpenPositionsPanel positions={open_positions} onRefresh={() => fetchData(false)} />

      <ClosedPositionsPanel positions={recent_closed_positions} />
    </div>
  )
}

type MetricCardProps = {
  label: string
  value: string
  accent?: 'default' | 'positive' | 'negative'
}

function MetricCard({ label, value, accent = 'default' }: MetricCardProps) {
  const accentClasses =
    accent === 'positive'
      ? 'text-emerald-700'
      : accent === 'negative'
        ? 'text-rose-700'
        : 'text-gray-900'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accentClasses}`}>{value}</p>
    </div>
  )
}

function OpenPositionsPanel({
  positions,
  onRefresh,
}: {
  positions: OpenPosition[]
  onRefresh?: () => void
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Open context shadow positions</h3>
          <p className="text-xs text-muted-foreground">
            Live mark-based P/L using bars_1m • auto-refreshes every 15s
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium">{positions.length} open</span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
            >
              Refresh now
            </button>
          )}
        </div>
      </div>
      {positions.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">No open positions right now.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold">Ticker</th>
                <th className="px-3 py-2 text-left font-semibold">Entry</th>
                <th className="px-3 py-2 text-left font-semibold">Mark</th>
                <th className="px-3 py-2 text-right font-semibold">P/L</th>
                <th className="px-3 py-2 text-left font-semibold">Stops</th>
                <th className="px-3 py-2 text-left font-semibold">Risk</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const pnlClass = pnlColor(pos.pnl_dollars)
                const sideLabel = (pos.side ?? '').toUpperCase()
                const isShort = sideLabel === 'SHORT'

                const canShowBar =
                  pos.entry_price !== null &&
                  pos.mark_price !== null &&
                  pos.take_profit !== null &&
                  pos.stop_loss !== null &&
                  !Number.isNaN(pos.entry_price) &&
                  !Number.isNaN(pos.mark_price) &&
                  !Number.isNaN(pos.take_profit) &&
                  !Number.isNaN(pos.stop_loss ?? NaN)

                return (
                  <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold">{pos.ticker ?? '—'}</div>
                        {sideLabel && (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${
                              isShort ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {sideLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Size {formatQty(pos.qty)} sh
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-mono text-sm">{formatCurrency(pos.entry_price)}</div>
                      <div className="text-[11px] text-muted-foreground">{formatNyDateTime(pos.entry_time)}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-sm align-top">{formatCurrency(pos.mark_price)}</td>
                    <td className={`px-3 py-2 text-right font-semibold align-top ${pnlClass}`}>
                      <div className="font-mono">{formatSignedCurrency(pos.pnl_dollars)}</div>
                      <div className="text-[11px]">{formatSignedPercent(pos.pnl_pct)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 space-y-1 align-top">
                      <div>SL {formatCurrency(pos.stop_loss)}</div>
                      <div>TP {formatCurrency(pos.take_profit)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 space-y-1 align-top">
                      <div>Risk {formatCurrency(pos.risk_dollars)}</div>
                      <div className="text-muted-foreground">Notional {formatCurrency(pos.notional_at_entry)}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ClosedPositionsPanel({ positions }: { positions: ClosedPosition[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Recently closed positions</h3>
          <p className="text-xs text-muted-foreground">Last {positions.length} closed context shadow trades</p>
        </div>
      </div>
      {positions.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">No recent closed positions.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold">Ticker</th>
                <th className="px-3 py-2 text-left font-semibold">Side</th>
                <th className="px-3 py-2 text-right font-semibold">Entry</th>
                <th className="px-3 py-2 text-right font-semibold">Exit</th>
                <th className="px-3 py-2 text-right font-semibold">PnL $</th>
                <th className="px-3 py-2 text-right font-semibold">R</th>
                <th className="px-3 py-2 text-left font-semibold">Closed</th>
                <th className="px-3 py-2 text-left font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const pnl = Number(pos.realized_pnl ?? 0)
                return (
                  <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-semibold">{pos.ticker ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                          pos.side === 'LONG'
                            ? 'bg-emerald-100 text-emerald-800'
                            : pos.side === 'SHORT'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {pos.side ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {pos.entry_price != null ? `$${pos.entry_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {pos.exit_price != null ? `$${pos.exit_price.toFixed(2)}` : '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        pnl >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {pnl >= 0 ? '+' : ''}
                      {pnl.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {pos.realized_r != null ? `${pos.realized_r.toFixed(2)}R` : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {pos.exit_time ? formatNyDateTime(pos.exit_time) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{pos.exit_reason ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `$${value.toFixed(2)}`
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const signed = value >= 0 ? '+' : ''
  return `${signed}${value.toFixed(2)}`
}

function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const signed = value >= 0 ? '+' : ''
  return `${signed}${value.toFixed(2)}%`
}

function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(0)
}

function pnlColor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return 'text-gray-700'
  return value > 0 ? 'text-green-600' : 'text-red-600'
}