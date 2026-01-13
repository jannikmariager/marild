'use client';

import { useState, useEffect } from 'react';

export function ShadowScalpEngine() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [metricsRes, paramsRes] = await Promise.all([
        fetch('/api/admin/shadow-scalp-metrics'),
        fetch('/api/admin/shadow-scalp-parameters'),
      ]);

      if (!metricsRes.ok || !paramsRes.ok) {
        throw new Error('Failed to fetch SCALP data');
      }

      const metrics = await metricsRes.json();
      const params = await paramsRes.json();

      setData({ metrics, params });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-sm text-gray-600">Loading SCALP metrics...</p>
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

  const metrics = data.metrics;
  const config = data.params.config;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Shadow Scalp Engine</h2>
        <p className="mt-1 text-sm text-gray-600">
          SCALP_V1_MICROEDGE · Isolated $100k portfolio · Deterministic position sizing
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Current Equity</p>
          <p className="mt-2 text-xl font-bold text-gray-900">${metrics?.current_equity?.toFixed(0) || '100,000'}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total P&L</p>
          <p className={`mt-2 text-xl font-bold ${(metrics?.total_pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${(metrics?.total_pnl ?? 0).toFixed(2)}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Win Rate</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{metrics?.win_rate_pct?.toFixed(1) || '0'}%</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Open Positions</p>
          <p className="mt-2 text-xl font-bold text-gray-900">
            {metrics?.open_positions || 0}/{metrics?.max_positions || 4}
          </p>
        </div>
      </div>

      {/* Sizing Parameters */}
      <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
        <h3 className="text-sm font-semibold text-blue-900 mb-4">Position Sizing Parameters</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Risk per Trade</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">
              {config?.risk_pct_per_trade || 0.15}% (max {config?.max_risk_pct_per_trade || 0.20}%)
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Total Risk Limit</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">
              {config?.max_total_open_risk_pct || 0.45}% of equity
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Max Positions</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">
              {config?.max_concurrent_positions || 4} / {config?.hard_max_positions || 5} hard
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Min Stop Distance</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">{config?.min_stop_distance_r || 0.08}R</p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Daily Loss Limit</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">{config?.max_daily_loss_pct || -0.75}%</p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Current Open Risk</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">
              {data.params.portfolio?.current_risk_pct || '0.000'}%
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Target R Range</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">
              {config?.target_r_low || 0.15}R - {config?.target_r_high || 0.30}R
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-blue-700 uppercase">Entry Filter</p>
            <p className="mt-1 font-mono font-semibold text-blue-900">≥{config?.min_confidence_pct || 60}% confidence</p>
          </div>
        </div>
      </div>

      {/* Sizing Decisions */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recent Sizing Decisions</h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Total Decisions</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {data.params.statistics?.total_decisions || 0}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg border border-green-200 p-4">
            <p className="text-xs font-medium text-green-700 uppercase">Entry Decisions</p>
            <p className="mt-2 text-2xl font-bold text-green-900">
              {data.params.statistics?.entry_decisions || 0}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg border border-red-200 p-4">
            <p className="text-xs font-medium text-red-700 uppercase">Skip Decisions</p>
            <p className="mt-2 text-2xl font-bold text-red-900">
              {data.params.statistics?.skip_decisions || 0}
            </p>
          </div>
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <p className="text-xs font-medium text-blue-700 uppercase">Entry Rate</p>
            <p className="mt-2 text-2xl font-bold text-blue-900">
              {data.params.statistics?.entry_rate || 0}%
            </p>
          </div>
        </div>
      </div>

      {/* Decisions Table */}
      {data.params.recent_decisions && data.params.recent_decisions.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left font-semibold">Ticker</th>
                  <th className="px-3 py-2 text-center font-semibold">Decision</th>
                  <th className="px-3 py-2 text-right font-semibold">Entry Price</th>
                  <th className="px-3 py-2 text-right font-semibold">Position Size</th>
                  <th className="px-3 py-2 text-right font-semibold">Risk %</th>
                  <th className="px-3 py-2 text-center font-semibold">Checks</th>
                  <th className="px-3 py-2 text-left font-semibold">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.params.recent_decisions.slice(0, 20).map((decision: any) => (
                  <tr key={decision.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-3 py-2 font-semibold">{decision.ticker}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded ${
                          decision.decision === 'ENTRY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {decision.decision}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">${decision.entry_price.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono">{decision.final_position_size.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {decision.new_trade_risk_pct.toFixed(3)}%
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex gap-1">
                        <span>{decision.check_max_positions_passed ? '✅' : '❌'}</span>
                        <span>{decision.check_total_risk_passed ? '✅' : '❌'}</span>
                        <span>{decision.check_duplicate_ticker_passed ? '✅' : '❌'}</span>
                        <span>{decision.check_daily_loss_passed ? '✅' : '❌'}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(decision.run_timestamp).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <button
        onClick={fetchData}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
      >
        Refresh
      </button>
    </div>
  );
}
