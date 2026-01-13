'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PerformanceInfoModal } from './performance-info-modal';
import { fetchPerformanceOverview, type PerformanceOverview } from '@/lib/performance';
import { ArrowUp, Lock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { usePerformanceV4 } from '@/lib/performance/usePerformanceV4';
import { usePortfolioPerformanceV4 } from '@/lib/performance/usePortfolioPerformanceV4';
import type { BacktestEngineType } from '@/lib/backtest/types_v4';

const TIMEFRAMES = ['YTD', '1Y', '6M', '3M', '1M', 'ALL'] as const;
const DEFAULT_TICKERS = ['AAPL', 'MSTR', 'TSLA', 'SPY'];

export function PerformanceTab() {
  const engineMode = process.env.NEXT_PUBLIC_BACKTEST_ENGINE ?? 'v3';

  if (engineMode === 'v4') {
    return <PerformanceTabV4 />;
  }

  return <PerformanceTabV3 />;
}

function PerformanceTabV3() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('YTD');
  const [data, setData] = useState<PerformanceOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTimeframe]);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const overview = await fetchPerformanceOverview(selectedTimeframe);
      setData(overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <PerformanceLoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-12">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={loadData} className="mt-4">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  // Show locked state
  if (data.access.is_locked) {
    return <PerformanceLockedState />;
  }

  if (!data.snapshot) {
    return (
      <div className="flex items-center justify-center p-12">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>No Data Available</CardTitle>
            <CardDescription>
              {data.message || 'Performance data will be available after the next daily update.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const snapshot = data.snapshot;
  const strategyReturnPct = (snapshot.strategy_return * 100).toFixed(2);
  const benchmarkReturnPct = (snapshot.benchmark_return * 100).toFixed(2);
  const outperformance = ((snapshot.strategy_return - snapshot.benchmark_return) * 100).toFixed(2);

  // Prepare chart data
  const chartData = data.equity_curve.map(point => ({
    date: new Date(point.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    'Marild AI': point.strategy_equity,
    [snapshot.benchmark_symbol]: point.benchmark_equity,
  }));

  const stats = [
    {
      title: 'Win Rate',
      value: `${(snapshot.win_rate * 100).toFixed(1)}%`,
      description: 'Winning trades',
    },
    {
      title: 'Avg Return',
      value: `${(snapshot.avg_trade_return * 100).toFixed(2)}%`,
      description: 'Per trade',
    },
    {
      title: 'Max Drawdown',
      value: `${(snapshot.max_drawdown * 100).toFixed(1)}%`,
      description: 'Worst decline',
    },
    {
      title: 'Best Trade',
      value: `${(snapshot.best_trade_return * 100).toFixed(1)}%`,
      description: 'Single trade',
    },
    {
      title: 'Worst Trade',
      value: `${(snapshot.worst_trade_return * 100).toFixed(1)}%`,
      description: 'Single trade',
    },
    {
      title: 'TP Hit Rate',
      value: `${(snapshot.tp_hit_rate * 100).toFixed(1)}%`,
      description: 'Targets reached',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>AI Signal Performance</CardTitle>
            <CardDescription>Hypothetical model portfolio</CardDescription>
          </div>
          <PerformanceInfoModal />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-[#0AAE84]">
                {strategyReturnPct}%
              </span>
              <span className="text-muted-foreground">
                vs {snapshot.benchmark_symbol} ({benchmarkReturnPct}%)
              </span>
            </div>
            
            <div className="flex items-center gap-2 text-sm">
              <ArrowUp className="h-4 w-4 text-[#0AAE84]" />
              <span className="font-semibold">
                Outperformance: {outperformance}%
              </span>
            </div>

            <div className="flex gap-2 flex-wrap">
              {TIMEFRAMES.map(tf => (
                <Button
                  key={tf}
                  variant={selectedTimeframe === tf ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedTimeframe(tf)}
                  className={selectedTimeframe === tf ? 'bg-[#0AAE84] hover:bg-[#0AAE84]/90' : ''}
                >
                  {tf}
                </Button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              {snapshot.sample_size} trades • Updated {new Date(snapshot.updated_at).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Equity Curve */}
      <Card>
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
          <CardDescription>Model portfolio growth over time</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
              <Line type="monotone" dataKey="Marild AI" stroke="#0AAE84" strokeWidth={2} />
              <Line type="monotone" dataKey={snapshot.benchmark_symbol} stroke="#94A3B8" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Disclaimer */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground text-center">
            {data.disclaimer}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PerformanceTabV4() {
  const engineType: BacktestEngineType = 'DAYTRADER';
  const { data: singleData, isLoading: singleLoading, error: singleError } = usePerformanceV4({
    tickers: DEFAULT_TICKERS,
    engineType,
  });
  const { data: portfolioData, loading: portfolioLoading, error: portfolioError } = usePortfolioPerformanceV4({
    tickers: DEFAULT_TICKERS,
    engineType,
  });

  const isLoading = singleLoading || portfolioLoading;
  const error = singleError || portfolioError;

  if (isLoading) {
    return <PerformanceLoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-12">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!singleData || !portfolioData) return null;

  const {
    ticker,
    timeframe_used,
    horizon_days,
    win_rate,
    avg_return,
    max_drawdown,
    trades,
    bars_loaded,
    fallback_used,
    anomalies,
  } = singleData;

  const { portfolioEquity, benchmarkEquity, perTicker, metrics } = portfolioData;

  const chartData = (portfolioEquity || []).map((p, idx) => {
    const bm = benchmarkEquity[idx];
    return {
      date: new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      portfolio: p.v,
      benchmark: bm ? bm.v : null,
    };
  });

  return (
    <div className="space-y-6">
      {/* Hero Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>AI Backtest Performance (V4)</CardTitle>
            <CardDescription>
              {ticker ? `${ticker} • ${timeframe_used} • Last ${horizon_days} days` : 'Massive+Yahoo backtest engine'}
            </CardDescription>
          </div>
          <PerformanceInfoModal />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* PRO Metrics Panel */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Final Return</p>
                <p className={`text-2xl font-bold ${metrics.final_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {metrics.final_return >= 0 ? '+' : ''}{metrics.final_return.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Volatility</p>
                <p className="text-2xl font-bold">{(metrics.volatility * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Profit Factor</p>
                <p className="text-2xl font-bold">{Number.isFinite(metrics.profit_factor) ? metrics.profit_factor.toFixed(2) : '∞'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Expectancy (R)</p>
                <p className={`text-2xl font-bold ${metrics.expectancy >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {metrics.expectancy >= 0 ? '+' : ''}{metrics.expectancy.toFixed(2)}R
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">SQN</p>
                <p className="text-2xl font-bold">{metrics.sqn.toFixed(2)}</p>
              </div>
            </div>

            {/* Single-ticker stats (DAYTRADER focus) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold">{win_rate.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg R</p>
                <p className={`text-2xl font-bold ${avg_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {avg_return >= 0 ? '+' : ''}{avg_return.toFixed(2)}R
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Max Drawdown</p>
                <p className="text-2xl font-bold text-red-600">-{max_drawdown.toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Trades</p>
                <p className="text-2xl font-bold">{trades}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Bars loaded: {bars_loaded} • Timeframe: {timeframe_used || 'n/a'}
            </p>

            {fallback_used && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Data fallback used — incomplete Massive history for this timeframe.</span>
              </div>
            )}

            {anomalies.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 mt-0.5" />
                <span>Data anomalies detected: {anomalies.join(', ')}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Portfolio vs Benchmark Equity Curve */}
      <Card>
        <CardHeader>
          <CardTitle>Portfolio vs SPY</CardTitle>
          <CardDescription>Normalized equity curves (rebased to 100)</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${value.toFixed(0)}`}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value.toFixed(2)}%`,
                  name === 'portfolio' ? 'Portfolio' : 'SPY',
                ]}
              />
              <Legend formatter={(value) => (value === 'portfolio' ? 'Portfolio' : 'SPY')} />
              <Line
                type="monotone"
                dataKey="portfolio"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                name="Portfolio"
              />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#94a3b8"
                strokeDasharray="5 5"
                strokeWidth={2}
                dot={false}
                name="SPY"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-ticker breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Ticker Breakdown</CardTitle>
          <CardDescription>R-multiple and system quality per symbol</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-4 text-left">Ticker</th>
                  <th className="py-2 pr-4 text-right">Trades</th>
                  <th className="py-2 pr-4 text-right">Win %</th>
                  <th className="py-2 pr-4 text-right">Expectancy (R)</th>
                  <th className="py-2 pr-4 text-right">SQN</th>
                </tr>
              </thead>
              <tbody>
                {perTicker.map((row) => (
                  <tr key={row.ticker} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{row.ticker}</td>
                    <td className="py-2 pr-4 text-right">{row.trades}</td>
                    <td className="py-2 pr-4 text-right">{row.win_rate.toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-right">{row.expectancy.toFixed(2)}R</td>
                    <td className="py-2 pr-4 text-right">{row.sqn.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PerformanceLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-32 mb-4" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function PerformanceLockedState() {
  return (
    <div className="flex items-center justify-center p-12">
      <Card className="max-w-md">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-muted p-4">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">Pro Feature</h3>
            <p className="text-sm text-muted-foreground">
              Performance analytics are available exclusively for Pro subscribers.
            </p>
          </div>
          <Link href="/settings">
            <Button className="w-full bg-[#0AAE84] hover:bg-[#0AAE84]/90">
              Upgrade to Pro
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
