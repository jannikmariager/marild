'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import {
  TrendingUp,
  TrendingDown,
  PieChart,
  BarChart3,
  ArrowUp,
  ArrowDown,
  LineChart,
  Lock,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { LineChart as RechartsLine, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface EquityPoint {
  t: string;
  equity: number;
}

interface WhatIfData {
  window: number;
  total_return_pct: number;
  win_rate: number;
  wins: number;
  losses: number;
  best_symbol: string | null;
  worst_symbol: string | null;
  best_return: number;
  worst_return: number;
  equity_curve: EquityPoint[];
  cached: boolean;
  locked?: boolean;
  message?: string;
}

interface WhatIfCardProps {
  window?: number;
}

export function WhatIfCard({ window = 10 }: WhatIfCardProps) {
  const [data, setData] = useState<WhatIfData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWhatIf();
  }, [window]);

  async function fetchWhatIf() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/performance-whatif?window=${window}`);

      if (response.status === 403) {
        setIsLocked(true);
        setIsLoading(false);
        return;
      }

      if (response.status === 401) {
        setIsLocked(true);
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('What-If fetch failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
      setIsLocked(result.locked || false);
    } catch (err) {
      console.error('Error fetching What-If performance:', err);
      setError('Failed to load performance data');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>What if you followed this?</CardTitle>
              <CardDescription>Last {window} signals</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLocked) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="flex items-center gap-2">
              What if you followed this?
              <Lock className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 px-4 bg-muted/50 rounded-lg border">
            <Lock className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2 text-center">
              This feature is part of Marild Pro
            </h3>
          <p className="text-sm text-muted-foreground mb-4 text-center">
            See hypothetical performance from following AI signals
          </p>
          <UpgradeButton className="w-full justify-center">
            Upgrade to PRO
          </UpgradeButton>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <CardTitle>What if you followed this?</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const isPositive = data.total_return_pct > 0;
  const returnColor = isPositive ? 'text-green-600' : 'text-red-600';
  const returnBg = isPositive ? 'bg-green-50' : 'bg-red-50';
  const returnBorder = isPositive ? 'border-green-200' : 'border-red-200';

  // Prepare chart data
  const chartData = data.equity_curve.map((point) => ({
    time: new Date(point.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    equity: point.equity,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>What if you followed this?</CardTitle>
            <CardDescription>Last {data.window} signals</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Return Display */}
        <div className={`p-5 rounded-xl border ${returnBg} ${returnBorder}`}>
          <div className="flex items-center justify-center gap-3 mb-2">
            {isPositive ? (
              <TrendingUp className="h-8 w-8 text-green-600" />
            ) : (
              <TrendingDown className="h-8 w-8 text-red-600" />
            )}
            <span className={`text-4xl font-bold ${returnColor}`}>
              {isPositive ? '+' : ''}
              {data.total_return_pct.toFixed(2)}%
            </span>
          </div>
          <p className="text-center text-sm text-muted-foreground">Total Return</p>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-lg bg-muted border">
            <div className="flex items-center gap-2 mb-2">
              <PieChart className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Win Rate</span>
            </div>
            <p className="text-2xl font-bold">{data.win_rate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.wins}W / {data.losses}L
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted border">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Trades</span>
            </div>
            <p className="text-2xl font-bold">{data.wins + data.losses}</p>
            <p className="text-xs text-muted-foreground mt-1">signals followed</p>
          </div>
        </div>

        {/* Best/Worst Trades */}
        {(data.best_symbol || data.worst_symbol) && (
          <div className="grid grid-cols-2 gap-3">
            {data.best_symbol && (
              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center gap-1 mb-2">
                  <ArrowUp className="h-3 w-3 text-green-600" />
                  <span className="text-xs text-muted-foreground">Best Trade</span>
                </div>
                <p className="font-semibold">{data.best_symbol}</p>
                <p className="text-sm text-green-600 font-semibold">
                  +{data.best_return.toFixed(2)}%
                </p>
              </div>
            )}

            {data.worst_symbol && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-center gap-1 mb-2">
                  <ArrowDown className="h-3 w-3 text-red-600" />
                  <span className="text-xs text-muted-foreground">Worst Trade</span>
                </div>
                <p className="font-semibold">{data.worst_symbol}</p>
                <p className="text-sm text-red-600 font-semibold">
                  {data.worst_return.toFixed(2)}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Mini Equity Curve Chart */}
        {chartData.length > 1 && (
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLine data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke={isPositive ? '#10b981' : '#ef4444'}
                  strokeWidth={2}
                  dot={false}
                />
              </RechartsLine>
            </ResponsiveContainer>
          </div>
        )}

        {/* CTA Button */}
        <Button asChild variant="outline" className="w-full">
          <Link href="/tradesignals?tab=performance" className="flex items-center gap-2">
            <LineChart className="h-4 w-4" />
            See Full Backtest
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
