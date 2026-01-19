'use client';

import { useEffect, useState } from 'react';

type QuickProfitMetrics = {
  total_trades: number;
  trades_won: number;
  trades_lost: number;
  win_rate_pct: number;
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
    metrics: { status: string; metrics: QuickProfitMetrics; trades: QuickProfitTrade[] };
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
    const interval = setInterval(fetchData, 30000);
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

  const { metrics, params } = data;
  const quickMetrics = metrics.metrics;
  const config = params.config;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Quick profit shadow engine</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          QUICK_PROFIT_V1 · Breakeven + partial take-profit automation running against the live SWING universe
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Current equity" value={`$${(quickMetrics?.current_equity ?? 0).toLocaleString()}`} />
        <MetricCard
          label="Total P&L"
          value={`$${(quickMetrics?.total_pnl ?? 0).toFixed(0)}`}
          accent={quickMetrics?.total_pnl >= 0 ? 'positive' : 'negative'}
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
                    <td className="px-3 py-2 text-gray-600">{new Date(decision.created_at).toLocaleString()}</td>
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
          <p className="text-xs text-muted-foreground">Last {metrics.trades.length} closed engine trades</p>
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
              {metrics.trades.map((trade) => {
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
                      {trade.exit_time ? new Date(trade.exit_time).toLocaleString() : '—'}
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
