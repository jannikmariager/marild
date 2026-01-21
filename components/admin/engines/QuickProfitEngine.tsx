'use client';

import { Fragment, useEffect, useState } from 'react';
import { formatNyDateTime } from '@/lib/datetime';
import { RiskRewardBar } from '@/components/performance/RiskRewardBar';

type QuickProfitMetrics = {
  total_trades: number;
  trades_won: number;
  trades_lost: number;
  win_rate_pct: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  total_pnl: number;
  avg_trade_r: number;
  open_positions: number;
  max_positions: number;
  current_equity: number;
  starting_equity: number;
};

type QuickProfitTrade = {
  id: string;
  ticker: string | null;
  entry_price: number | null;
  exit_price: number | null;
  entry_time: string | null;
  exit_time: string | null;
  pnl_dollars: number | null;
  pnl_r: number | null;
  side: string | null;
  status: string;
};
type QuickProfitOpenPosition = {
  id: string;
  ticker: string | null;
  side: string | null;
  qty: number | null;
  entry_price: number | null;
  entry_time: string | null;
  stop_loss: number | null;
  take_profit: number | null;
  notional_at_entry: number | null;
  risk_dollars: number | null;
  mark_price: number | null;
  pnl_dollars: number | null;
  pnl_pct: number | null;
  be_activated_at: string | null;
  breakeven_active: boolean;
  partial_taken: boolean;
  trail_active: boolean;
  trail_stop_price: number | null;
  trail_peak_pnl: number | null;
};

type QuickProfitClosedPosition = {
  id: string;
  ticker: string | null;
  side: string | null;
  qty: number | null;
  entry_price: number | null;
  entry_time: string | null;
  exit_price: number | null;
  exit_time: string | null;
  realized_pnl: number | null;
  realized_r: number | null;
  pnl_pct: number | null;
  exit_reason: string | null;
  be_activated_at: string | null;
  breakeven_active: boolean;
  partial_taken: boolean;
  trail_active: boolean;
  trail_stop_price: number | null;
  trail_peak_pnl: number | null;
};

type QuickProfitMetricsResponse = {
  status: string;
  metrics: QuickProfitMetrics;
  trades: QuickProfitTrade[];
  open_positions: QuickProfitOpenPosition[];
  recent_closed_positions: QuickProfitClosedPosition[];
};

type QuickProfitDecision = {
  id: string;
  ticker: string;
  action: string;
  pnl_usd: number;
  price: number;
  created_at: string;
  metadata?: Record<string, unknown>;
};

type QuickProfitConfig = {
  be_trigger_usd: number;
  be_buffer_usd: number;
  partial_trigger_usd: number;
  partial_fraction: number;
  trail_distance_usd: number;
  risk_pct_per_trade: number;
  max_concurrent_positions: number;
  max_notional_pct: number;
  max_portfolio_pct: number;
  min_position_notional: number;
  lookback_hours: number;
};

export function QuickProfitEngine() {
  const [data, setData] = useState<{
    metrics: QuickProfitMetricsResponse;
    params: {
      config: QuickProfitConfig;
      portfolio: {
        equity: number;
        starting_equity: number;
        allocated_notional: number;
        open_positions_count: number;
        current_risk_pct: string;
      };
      statistics: {
        total_decisions: number;
        open_actions: number;
        close_actions: number;
        entry_rate: string;
      };
      recent_decisions: QuickProfitDecision[];
    };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    // Poll more frequently so admin open-position marks feel "live"
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      setIsLoading(true);
      setError(null);
      const [metricsRes, paramsRes] = await Promise.all([
        fetch('/api/admin/quick-profit-metrics'),
        fetch('/api/admin/quick-profit-parameters'),
      ]);
      if (!metricsRes.ok || !paramsRes.ok) {
        throw new Error('Failed to fetch Quick profit data');
      }
      const metrics = await metricsRes.json();
      const params = await paramsRes.json();
      setData({ metrics, params });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        <p className="mt-4 text-sm text-gray-600">Loading Quick profit metrics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-6">
        <h3 className="text-sm font-semibold text-red-900">Error</h3>
        <p className="mt-2 text-sm text-red-700">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div>No data</div>;
  }

  const { metrics: metricsPayload, params } = data;
  const quickMetrics = metricsPayload.metrics;
  const config = params.config;
  const openPositions = metricsPayload.open_positions ?? [];
  const closedPositions = metricsPayload.recent_closed_positions ?? [];
  const trades = metricsPayload.trades ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Quick profit shadow engine</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          QUICK_PROFIT_V1 - Breakeven + partial take-profit automation running against the live SWING universe
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <MetricCard label="Current equity" value={`$${(quickMetrics?.current_equity ?? 0).toLocaleString()}`} />
        <MetricCard
          label="Total P&L"
          value={`$${(quickMetrics?.total_pnl ?? 0).toFixed(0)}`}
          accent={quickMetrics?.total_pnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          label="Realized P&L"
          value={`$${(quickMetrics?.realized_pnl ?? 0).toFixed(0)}`}
          accent={(quickMetrics?.realized_pnl ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          label="Unrealized P&L"
          value={`$${(quickMetrics?.unrealized_pnl ?? 0).toFixed(0)}`}
          accent={(quickMetrics?.unrealized_pnl ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard label="Win rate" value={`${quickMetrics?.win_rate_pct?.toFixed(1) ?? '0'}%`} />
        <MetricCard
          label="Open positions"
          value={`${quickMetrics?.open_positions ?? 0}/${quickMetrics?.max_positions ?? 0}`}
        />
      </div>

      <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-6">
        <h3 className="text-sm font-semibold text-emerald-900 mb-4">Profit protection configuration</h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <ConfigItem label="Breakeven trigger" value={`$${config.be_trigger_usd.toFixed(0)}`} />
          <ConfigItem label="BE buffer" value={`$${config.be_buffer_usd.toFixed(0)}`} />
          <ConfigItem label="Partial trigger" value={`$${config.partial_trigger_usd.toFixed(0)}`} />
          <ConfigItem label="Partial fraction" value={`${(config.partial_fraction * 100).toFixed(0)}%`} />
          <ConfigItem label="Trail distance" value={`$${config.trail_distance_usd.toFixed(0)}`} />
          <ConfigItem label="Risk / trade" value={`${(config.risk_pct_per_trade * 100).toFixed(2)}%`} />
          <ConfigItem label="Max positions" value={`${config.max_concurrent_positions}`} />
          <ConfigItem label="Lookback window" value={`${config.lookback_hours}h`} />
          <ConfigItem label="Max per position" value={`${(config.max_notional_pct * 100).toFixed(0)}% equity`} />
          <ConfigItem label="Portfolio allocation cap" value={`${(config.max_portfolio_pct * 100).toFixed(0)}%`} />
        </dl>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Decisions logged" value={params.statistics.total_decisions.toString()} />
        <MetricCard label="Open actions" value={params.statistics.open_actions.toString()} />
        <MetricCard label="Close actions" value={params.statistics.close_actions.toString()} />
        <MetricCard label="Entry rate" value={`${params.statistics.entry_rate}%`} />
      </div>

      <OpenPositionsPanel positions={openPositions} onRefresh={fetchData} />

      <ClosedPositionsPanel positions={closedPositions} />
      {params.recent_decisions?.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Recent Quick profit actions</h3>
              <p className="text-xs text-muted-foreground">Latest 20 entries from live_signal_decision_log</p>
            </div>
            <button
              onClick={fetchData}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline"
            >
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left font-semibold">Ticker</th>
                  <th className="px-3 py-2 text-left font-semibold">Action</th>
                  <th className="px-3 py-2 text-right font-semibold">PnL (USD)</th>
                  <th className="px-3 py-2 text-right font-semibold">Price</th>
                  <th className="px-3 py-2 text-left font-semibold">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {params.recent_decisions.slice(0, 20).map((decision) => (
                  <tr key={decision.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-semibold">{decision.ticker}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                          decision.action === 'OPEN'
                            ? 'bg-emerald-100 text-emerald-800'
                            : decision.action === 'CLOSE'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {decision.action}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        (decision.pnl_usd ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {(decision.pnl_usd ?? 0) >= 0 ? '+' : ''}
                      {(decision.pnl_usd ?? 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {decision.price ? `$${decision.price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{formatNyDateTime(decision.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Recent trades</h3>
          <p className="text-xs text-muted-foreground">Last {trades.length} closed engine trades</p>
        </div>
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
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const pnl = Number(trade.pnl_dollars ?? 0)
                return (
                  <tr key={trade.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-semibold">{trade.ticker ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                          trade.side === 'LONG'
                            ? 'bg-emerald-100 text-emerald-800'
                            : trade.side === 'SHORT'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {trade.side ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {trade.entry_price ? `$${trade.entry_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '—'}
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
                      {trade.pnl_r != null ? `${trade.pnl_r.toFixed(2)}R` : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {trade.exit_time ? formatNyDateTime(trade.exit_time) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
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

type ConfigItemProps = {
  label: string
  value: string
}

function ConfigItem({ label, value }: ConfigItemProps) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900">{value}</dd>
    </div>
  )
}


function OpenPositionsPanel({
  positions,
  onRefresh,
}: {
  positions: QuickProfitOpenPosition[];
  onRefresh?: () => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Open Quick profit positions</h3>
          <p className="text-xs text-muted-foreground">
            Live mark-based P/L with breakeven & trailing state • auto-refreshes every 10s
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
        <EmptyState message="No open positions right now." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold">Ticker</th>
                <th className="px-3 py-2 text-left font-semibold">Entry</th>
                <th className="px-3 py-2 text-left font-semibold">Mark</th>
                <th className="px-3 py-2 text-right font-semibold">P/L</th>
                <th className="px-3 py-2 text-left font-semibold">Management</th>
                <th className="px-3 py-2 text-left font-semibold">Stops</th>
                <th className="px-3 py-2 text-left font-semibold">Risk</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const pnlClass = pnlColor(pos.pnl_dollars);
                const sideLabel = (pos.side ?? '').toUpperCase();
                const isShort = sideLabel === 'SHORT';
                const activeStop =
                  pos.trail_active && pos.trail_stop_price !== null && !Number.isNaN(pos.trail_stop_price)
                    ? pos.trail_stop_price
                    : pos.stop_loss;
                const canShowBar =
                  pos.entry_price !== null &&
                  pos.mark_price !== null &&
                  pos.take_profit !== null &&
                  activeStop !== null &&
                  !Number.isNaN(pos.entry_price) &&
                  !Number.isNaN(pos.mark_price) &&
                  !Number.isNaN(pos.take_profit) &&
                  !Number.isNaN(activeStop ?? NaN);

                return (
                  <Fragment key={pos.id}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
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
                      <td className="px-3 py-2 align-top">
                        <ManagementBadges
                          breakevenActive={pos.breakeven_active}
                          trailActive={pos.trail_active}
                          partialTaken={pos.partial_taken}
                          beActivatedAt={pos.be_activated_at}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 space-y-1 align-top">
                        <div>SL {formatCurrency(pos.stop_loss)}</div>
                        {pos.trail_stop_price !== null && (
                          <div>Trail {formatCurrency(pos.trail_stop_price)}</div>
                        )}
                        <div>TP {formatCurrency(pos.take_profit)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 space-y-1 align-top">
                        <div>Risk {formatCurrency(pos.risk_dollars)}</div>
                        <div className="text-muted-foreground">Notional {formatCurrency(pos.notional_at_entry)}</div>
                      </td>
                    </tr>
                    {canShowBar && (
                      <tr className="border-b border-gray-100 bg-slate-50/60">
                        <td colSpan={7} className="px-3 pb-3 pt-1 overflow-hidden">
                          <RiskRewardBar
                            signalEntryPrice={pos.entry_price as number}
                            activeSlPrice={activeStop as number}
                            tp1Price={pos.take_profit as number}
                            currentPrice={pos.mark_price as number}
                            side={isShort ? 'SHORT' : 'LONG'}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClosedPositionsPanel({ positions }: { positions: QuickProfitClosedPosition[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Recently closed positions</h3>
          <p className="text-xs text-muted-foreground">Exit reason plus realized P/L cues</p>
        </div>
        <span className="text-xs font-medium text-muted-foreground">{positions.length} shown</span>
      </div>
      {positions.length === 0 ? (
        <EmptyState message="No shadow closes yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold">Ticker</th>
                <th className="px-3 py-2 text-left font-semibold">Entry / Exit</th>
                <th className="px-3 py-2 text-right font-semibold">Realized P/L</th>
                <th className="px-3 py-2 text-left font-semibold">Exit reason</th>
                <th className="px-3 py-2 text-left font-semibold">Management</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const pnlClass = pnlColor(pos.realized_pnl)
                return (
                  <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{pos.ticker ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {pos.side?.toLowerCase() ?? '—'} - {formatQty(pos.qty)} sh
                      </div>
                    </td>
                    <td className="px-3 py-2 space-y-1">
                      <div className="text-xs">
                        <span className="font-medium text-gray-900">Entry:</span> {formatCurrency(pos.entry_price)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{formatNyDateTime(pos.entry_time)}</div>
                      <div className="text-xs pt-1">
                        <span className="font-medium text-gray-900">Exit:</span> {formatCurrency(pos.exit_price)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{formatNyDateTime(pos.exit_time)}</div>
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${pnlClass}`}>
                      <div className="font-mono">{formatSignedCurrency(pos.realized_pnl)}</div>
                      <div className="text-[11px]">{formatSignedPercent(pos.pnl_pct)}</div>
                      <div className="text-[11px]">{formatSignedR(pos.realized_r)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <ExitReasonPill reason={pos.exit_reason} />
                    </td>
                    <td className="px-3 py-2">
                      <ManagementBadges
                        breakevenActive={pos.breakeven_active}
                        trailActive={pos.trail_active}
                        partialTaken={pos.partial_taken}
                        beActivatedAt={pos.be_activated_at}
                      />
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

function EmptyState({ message }: { message: string }) {
  return <div className="px-4 py-6 text-center text-sm text-muted-foreground">{message}</div>
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(Number(value)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${Number(value) >= 0 ? '+' : '-'}$${abs}`
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(Number(value)).toFixed(2)
  return `${Number(value) >= 0 ? '+' : '-'}${abs}%`
}

function formatSignedR(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(Number(value)).toFixed(2)
  return `${Number(value) >= 0 ? '+' : '-'}${abs}R`
}

function formatQty(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}


function pnlColor(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'text-gray-700'
  if (value > 0) return 'text-emerald-600'
  if (value < 0) return 'text-rose-600'
  return 'text-gray-700'
}

function ManagementBadges({
  breakevenActive,
  trailActive,
  partialTaken,
  beActivatedAt,
}: {
  breakevenActive: boolean
  trailActive: boolean
  partialTaken: boolean
  beActivatedAt?: string | null
}) {
  const badges: Array<{ label: string; classes: string; title?: string }> = []
  if (breakevenActive) {
    badges.push({
      label: 'Breakeven',
      classes: 'bg-emerald-100 text-emerald-800',
      title: beActivatedAt ? `Activated ${formatNyDateTime(beActivatedAt)}` : undefined,
    })
  }
  if (trailActive) {
    badges.push({ label: 'Trailing', classes: 'bg-blue-100 text-blue-800' })
  }
  if (partialTaken) {
    badges.push({ label: 'Partial', classes: 'bg-amber-100 text-amber-800' })
  }

  if (badges.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${badge.classes}`}
          title={badge.title}
        >
          {badge.label}
        </span>
      ))}
    </div>
  )
}

const EXIT_REASON_LABELS: Record<string, string> = {
  TAKE_PROFIT: 'Take profit',
  TRAILING_STOP: 'Trailing stop',
  BREAKEVEN: 'Breakeven stop',
  STOP_LOSS: 'Stop-loss',
  MANUAL_EXIT: 'Manual exit',
  EARLY_PROTECTION: 'Early protection',
  PARTIAL_EXIT: 'Partial exit',
};

function humanizeExitReason(reason: string | null | undefined) {
  if (!reason) return '—'
  const key = reason.toUpperCase()
  if (EXIT_REASON_LABELS[key]) return EXIT_REASON_LABELS[key]
  return reason.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (s) => s.toUpperCase())
}

function ExitReasonPill({ reason }: { reason: string | null | undefined }) {
  const label = humanizeExitReason(reason)
  if (!reason) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return <span className="inline-flex px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-700">{label}</span>
}
