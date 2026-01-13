'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import BacktestEquityChart from './BacktestEquityChart';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ProLockedCard from '@/components/feed/ProLockedCard';
import StatsGrid from './StatsGrid';
import EquityChart from './EquityChart';
import TradeTable from './TradeTable';
import AITradeLog from './AITradeLog';
import LiveTrading from './LiveTrading';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface PerformanceSummary {
  starting_equity: number;
  current_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  trades_count: number;
  win_rate_pct: number;
  best_trade_pct: number | null;
  worst_trade_pct: number | null;
  equity_curve: Array<{
    date: string;
    equity: number;
  }>;
  engine_version?: 'V3' | 'V3_5';
  access: {
    is_locked: boolean;
  };
}

interface TickerStats {
  ticker: string;
  trades: number;
  win_rate: number;
  expectancy: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
}

interface UniverseTicker {
  ticker: string;
  horizons: string[]; // ['day', 'swing', 'invest']
  stats: Record<string, TickerStats>; // { day: {...}, swing: {...} }
  max_expectancy: number;
}

export default function PerformanceClient() {
  const searchParams = useSearchParams();

  const initialViewParam = (searchParams?.get('view') || '').toLowerCase();
  const initialView: 'backtest' | 'live' = initialViewParam === 'backtest' ? 'backtest' : 'live';

  const initialTickerFromQuery = (searchParams?.get('ticker') || '').toUpperCase();

  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default to LIVE view – this is the core feature, but allow overriding via ?view=backtest
  const [viewMode, setViewMode] = useState<'backtest' | 'live'>(initialView);

  const [universeTickers, setUniverseTickers] = useState<UniverseTicker[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string>(initialTickerFromQuery);

  const [backtestCurve, setBacktestCurve] = useState<{ date: string; equity: number }[] | null>(null);
  const [backtestHorizon, setBacktestHorizon] = useState<string | null>(null);

  // Load overall performance + universe once
  useEffect(() => {
    loadSummary();
    loadUniverse();
  }, []);

  // Reload backtest equity curve when ticker or horizons change in backtest view
  useEffect(() => {
    if (viewMode !== 'backtest') return;
    if (!selectedTicker) {
      setBacktestCurve(null);
      setBacktestHorizon(null);
      return;
    }

    const row = universeTickers.find((t) => t.ticker.toUpperCase() === selectedTicker.toUpperCase());
    if (!row || !row.horizons || row.horizons.length === 0) {
      setBacktestCurve(null);
      setBacktestHorizon(null);
      return;
    }

    // Use first available horizon (day for daytraders, swing for swing traders, etc.)
    const primaryHorizon = row.horizons[0];
    loadBacktestCurve(row.ticker, primaryHorizon);
  }, [viewMode, selectedTicker, universeTickers]);

  async function loadSummary() {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch overall performance summary (model portfolio across all trades)
      const response = await fetch('/api/performance/summary');
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to load performance data: ${response.status}`);
      }

      const data = await response.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadUniverse() {
    try {
      const response = await fetch('/api/performance/universe');
      const payload = (await response.json().catch(() => ({ tickers: [] }))) as {
        tickers: UniverseTicker[];
      };

      if (!response.ok) {
        throw new Error(payload && (payload as any).message ? (payload as any).message : 'Failed to load performance universe');
      }

      const list = payload.tickers || [];
      // Sort alphabetically by ticker symbol
      list.sort((a, b) => a.ticker.localeCompare(b.ticker));
      setUniverseTickers(list);

      // Initialize selection to first ticker if not set
      if (!selectedTicker && list.length > 0) {
        setSelectedTicker(list[0].ticker);
      }
    } catch (err) {
      console.error('[PerformanceClient] Failed to load performance universe', err);
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-12">
            <div className="flex items-center justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error || !summary) {
    return (
      <Card>
        <CardContent className="p-12">
          <div className="flex flex-col items-center justify-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500" />
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Error loading performance
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {error || 'No data available'}
              </p>
              <Button onClick={loadSummary}>
                Retry
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Lookup ticker data for selected ticker
  const selectedTickerData =
    universeTickers.find((t) => t.ticker.toUpperCase() === selectedTicker.toUpperCase()) || null;

  async function loadBacktestCurve(ticker: string, horizon: string) {
    try {
      setBacktestHorizon(horizon);
      const params = new URLSearchParams({ ticker, horizon });
      const response = await fetch(`/api/performance/backtest-equity?${params.toString()}`);
      const payload = (await response.json().catch(() => ({ equity_curve: [] }))) as {
        equity_curve: { date: string; equity: number }[];
      };
      if (!response.ok) {
        console.error('[PerformanceClient] Failed to load backtest equity curve', payload);
        setBacktestCurve(null);
        return;
      }
      setBacktestCurve(payload.equity_curve || []);
    } catch (err) {
      console.error('[PerformanceClient] Error loading backtest equity curve', err);
      setBacktestCurve(null);
    }
  }
  
  // Helper to format horizon names
  const formatHorizon = (h: string) => {
    if (h === 'day') return 'DAYTRADE';
    if (h === 'swing') return 'SWING';
    if (h === 'invest') return 'INVESTOR';
    return h.toUpperCase();
  };
  
  const horizonColors: Record<string, string> = {
    day: 'bg-orange-100 text-orange-700 border-orange-200',
    swing: 'bg-blue-100 text-blue-700 border-blue-200',
    invest: 'bg-purple-100 text-purple-700 border-purple-200',
  };

  // PRO lock check
  const content = (
    <div className="space-y-6">
      {/* Ticker Selector & Backtest Stats */}
      <Card>
          <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1 min-w-[220px] max-w-sm">
              <label className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                Approved performance universe
              </label>
              {/* Keep layout identical; just fade the dropdown out in live view */}
              <div className={viewMode === 'live' ? 'opacity-0 pointer-events-none' : ''}>
                <Select
                  value={selectedTicker}
                  onValueChange={(value) => setSelectedTicker(value)}
                >
                  <SelectTrigger className="h-10 bg-white border border-gray-200 shadow-sm text-sm font-medium text-gray-900 justify-between">
                    <span className="font-mono text-sm flex-1 truncate text-left">
                      {selectedTicker ? selectedTicker.toUpperCase() : 'Select a ticker'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {universeTickers.map((t) => (
                      <SelectItem key={t.ticker} value={t.ticker}>
                        <div className="flex items-center justify-between gap-2 w-full">
                          <span className="font-mono text-sm flex-1 truncate text-left">
                            {t.ticker.toUpperCase()}
                          </span>
                          <div className="flex flex-none gap-1">
                            {t.horizons.map((h) => (
                              <span
                                key={h}
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full border ${
                                  horizonColors[h] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                                }`}
                              >
                                {formatHorizon(h)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-sm text-gray-600 max-w-md space-y-2">
              {/* Live / Backtest toggle – stays anchored like Daytrader/Swing buttons */}
              <div className="inline-flex items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setViewMode('live')}
                  className={`px-4 py-1.5 rounded-full border font-semibold transition-colors ${
                    viewMode === 'live'
                      ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                      : 'bg-white text-gray-800 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  Live trading
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('backtest')}
                  className={`px-4 py-1.5 rounded-full border font-semibold transition-colors ${
                    viewMode === 'backtest'
                      ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                      : 'bg-white text-gray-800 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  Backtest view
                </button>
              </div>

              {/* Explanatory text below buttons; height changes do not move buttons */}
              <div className="min-h-[100px]">
                {viewMode === 'backtest' ? (
                  <div>
                    <div className="font-medium text-gray-900">Backtested by our latest performance engine</div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      These tickers have been evaluated by the newest Marild performance engine using thousands of
                      historical signals. Metrics are kept up to date as we refine the universe in the Engine Performance
                      dashboard. Backtests are simulated and do not guarantee future results.
                    </p>
                    <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-100">
                      <div><span className="font-semibold text-gray-600">DAYTRADER:</span> 365 days (5m bars) | Last run: Dec 11, 2025</div>
                      <div><span className="font-semibold text-gray-600">SWING:</span> 730 days (4h bars) | Last run: Dec 11, 2025</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Live model portfolios execute the latest AI signals in real time. Switch to Backtest view to see
                    long-term historical stats from the performance engine.
                  </p>
                )}
              </div>
            </div>
          </div>

          {selectedTickerData ? (
            <div className="space-y-3">
              <div className={viewMode === 'live' ? 'hidden' : 'flex flex-wrap gap-2 text-xs text-gray-600'}>
                <span className="font-semibold text-gray-800">Approved trading styles:</span>
                {selectedTickerData.horizons.map((h) => (
                  <span
                    key={h}
                    className={`px-2 py-0.5 rounded-full border ${horizonColors[h] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}
                  >
                    {formatHorizon(h)}
                  </span>
                ))}
              </div>

              {/* View Mode Content */}
              {viewMode === 'live' ? (
                <div className="mt-6">
                  <LiveTrading />
                </div>
              ) : viewMode === 'backtest' ? (
                <div className="grid grid-cols-1 md:grid-cols- selectedTickerData.horizons.length gap-4">
                  {selectedTickerData.horizons.map((horizonKey) => {
                    const stats = selectedTickerData.stats[horizonKey];
                    if (!stats || stats.trades <= 0) return null;
                    return (
                      <div
                        key={horizonKey}
                        className="p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-gray-700">
                            {formatHorizon(horizonKey)} backtest
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                              horizonColors[horizonKey] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                            }`}
                          >
                            {formatHorizon(horizonKey)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-[11px] text-gray-500 mb-0.5">Trades</div>
                            <div className="text-base font-semibold text-gray-900">{stats.trades}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-gray-500 mb-0.5">Win rate</div>
                            <div className="text-base font-semibold text-gray-900">
                              {(stats.win_rate * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-gray-500 mb-0.5">
                              Expectancy (R)
                              <span className="block text-[10px] text-gray-400">
                                Average profit per trade in risk units (e.g. 0.20R)
                              </span>
                            </div>
                            <div className="text-base font-semibold text-gray-900">
                              {stats.expectancy.toFixed(3)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-gray-500 mb-0.5">Max drawdown</div>
                            <div className="text-base font-semibold text-gray-900">
                              {stats.max_drawdown_pct.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  Live trading view shows the real-time model portfolio performance below. Backtest metrics remain
                  visible in the backtest view.
                </div>
              )}

              {viewMode === 'backtest' && (
                <>
                  {/* Horizon selector for multi-horizon tickers */}
                  {selectedTickerData && selectedTickerData.horizons.length > 1 && (
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-xs font-semibold text-gray-600">View equity curve:</span>
                      <div className="flex gap-2">
                        {selectedTickerData.horizons.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => loadBacktestCurve(selectedTickerData.ticker, h)}
                            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                              backtestHorizon === h
                                ? horizonColors[h] ?? 'bg-gray-200 text-gray-800 border-gray-300'
                                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            {formatHorizon(h)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {backtestCurve && backtestCurve.length > 0 && backtestHorizon && (
                    <BacktestEquityChart
                      data={backtestCurve}
                      horizonLabel={formatHorizon(backtestHorizon)}
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              No backtest metrics available yet for this ticker. It may be newly added to the performance universe.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Only show these in backtest mode */}
      {viewMode === 'backtest' && (
        <>
          {/* Stats Grid */}
          <StatsGrid summary={summary} />

          {/* Equity Chart */}
          <EquityChart summary={summary} />

          {/* Today's Activity */}
          <TradeTable />
        </>
      )}

      {/* AI Trade Log - Always show for full history */}
      <AITradeLog />

      {/* Transparency Notice */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-2">100% Transparent Performance</h3>
                <p className="text-sm text-gray-700 leading-relaxed">
                  This shows real trades from our AI executing its own generated signals. Every entry, exit, and P&L is tracked in real-time. 
                  No cherry-picking, no backtesting - just live performance you can verify.
                </p>
                <p className="text-xs text-gray-600 mt-2">
                  Model portfolio only. Past performance does not guarantee future results. Not financial advice.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <ProLockedCard
      isLocked={summary.access.is_locked}
      featureName="AI Performance Tracking"
      description="Watch our AI trade its own signals with 100% transparency. Real trades, real results, verified performance."
    >
      {content}
    </ProLockedCard>
  );
}
