'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  TrendingUp,
  ArrowRight,
  Lock,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import Link from 'next/link';
import { LineChart as RechartsLine, Line, ResponsiveContainer } from 'recharts';

interface PerformancePreview {
  return_pct: number;   // 0.0745 = 7.45%
  win_rate: number;     // 0.63 = 63%
  best_trade: number;   // 0.123 = 12.3%
  worst_trade: number;  // -0.049 = -4.9%
  sparkline: number[];  // [1.0, 1.01, 1.03, ...]
  spy_return?: number;  // SPY benchmark return
  qqq_return?: number;  // QQQ benchmark return
  is_live?: boolean;    // Indicates if data is from real performance engine
  access: {
    is_locked: boolean;
  };
}

export function PerformancePreviewCard() {
  const [data, setData] = useState<PerformancePreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPreview();
  }, []);

  async function fetchPreview() {
    setIsLoading(true);
    setError(null);

    try {
      // Use the same live model portfolio summary as the rest of the app
      const response = await fetch('/api/performance/summary?public=1', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || 'Performance data not available right now');
      }

      // Map /summary fields into preview shape
      const totalReturnPct = typeof payload.total_return_pct === 'number' ? payload.total_return_pct : 0; // percent
      const winRatePct = typeof payload.win_rate_pct === 'number' ? payload.win_rate_pct : 0; // percent
      const bestTradePct = typeof payload.best_trade_pct === 'number' ? payload.best_trade_pct : 0; // percent
      const worstTradePct = typeof payload.worst_trade_pct === 'number' ? payload.worst_trade_pct : 0; // percent

      const sparkline = Array.isArray(payload.equity_curve)
        ? payload.equity_curve.map((p: { equity: number }) => p.equity)
        : [];

      const previewData: PerformancePreview = {
        // Card expects decimals, summary returns percent
        return_pct: totalReturnPct / 100,
        win_rate: winRatePct / 100,
        best_trade: bestTradePct / 100,
        worst_trade: worstTradePct / 100,
        sparkline,
        spy_return: undefined,
        qqq_return: undefined,
        is_live: true,
        access: { is_locked: false },
      };

      setData(previewData);
    } catch (err: any) {
      console.error('Error fetching performance preview:', err);
      setError(err.message || 'Performance data not available right now');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-[#111827]">
              If you followed recent signals
            </CardTitle>
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-[#111827]">
              If you followed recent signals
            </CardTitle>
            <HelpCircleButton />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Big % placeholder */}
          <div className="text-center py-4">
            <span className="text-2xl font-semibold text-gray-400">No data available</span>
          </div>

          {/* Empty sparkline area */}
          <div className="h-10 w-full bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center">
            <span className="text-xs text-gray-400">No chart data</span>
          </div>

          {/* Micro-stats with placeholders */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-400 mb-1">Win Rate</p>
              <p className="text-sm text-gray-400">No data</p>
            </div>

            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-400 mb-1">Best Trade</p>
              <p className="text-sm text-gray-400">No data</p>
            </div>

            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-400 mb-1">Worst Trade</p>
              <p className="text-sm text-gray-400">No data</p>
            </div>
          </div>

          {/* CTA - disabled */}
          <Button
            variant="ghost"
            disabled
            className="w-full justify-between text-gray-400 cursor-not-allowed"
          >
            See Full Performance
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (data.access.is_locked) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-[#111827]">
              If you followed recent signals
            </CardTitle>
            <HelpCircleButton />
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {/* Blurred preview */}
            <div className="blur-sm pointer-events-none opacity-50">
              <div className="text-center py-8">
                <span className="text-4xl font-bold text-[#0AAE84]">+7.45%</span>
              </div>
              <div className="h-10 bg-[#E5E7EB] rounded-lg mb-4" />
              <div className="grid grid-cols-3 gap-3">
                <div className="h-16 bg-[#E5E7EB] rounded-lg" />
                <div className="h-16 bg-[#E5E7EB] rounded-lg" />
                <div className="h-16 bg-[#E5E7EB] rounded-lg" />
              </div>
            </div>

            {/* Lock overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
              <Lock className="h-12 w-12 text-[#374151] mb-3" />
              <h3 className="text-lg font-semibold text-[#111827] mb-2 text-center">
                Unlock Performance Analytics
              </h3>
              <p className="text-sm text-[#374151] mb-4 text-center max-w-xs">
                See equity curves, win rate, and trade-by-trade results.
              </p>
              <UpgradeButton className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white">
                Upgrade to PRO
              </UpgradeButton>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isPositive = data.return_pct > 0;
  const returnColor = isPositive ? 'text-[#0AAE84]' : 'text-[#EF4444]';

  // Prepare sparkline data
  const sparklineData = data.sparkline.map((value, index) => ({
    index,
    value,
  }));

  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-[#111827]">
              If you followed recent signals
            </CardTitle>
            {!data.is_live && (
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 rounded">
                No Data
              </span>
            )}
          </div>
          <HelpCircleButton />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Big % Number with Benchmarks */}
        <div className="space-y-2">
          <div className="text-center py-4">
            <span className={`text-5xl font-bold ${returnColor}`}>
              {isPositive ? '+' : ''}
              {(data.return_pct * 100).toFixed(2)}%
            </span>
          </div>
          
          {/* Benchmark Comparison Chips */}
          {(data.spy_return !== undefined || data.qqq_return !== undefined) && (
            <div className="flex items-center justify-center gap-2">
              {data.spy_return !== undefined && (
                <div className="px-3 py-1 rounded-full bg-gray-100 border border-gray-200">
                  <span className="text-xs text-gray-600">SPY: </span>
                  <span className={`text-xs font-semibold ${
                    data.spy_return > 0 ? 'text-[#0AAE84]' : 'text-red-600'
                  }`}>
                    {data.spy_return > 0 ? '+' : ''}{(data.spy_return * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {data.qqq_return !== undefined && (
                <div className="px-3 py-1 rounded-full bg-gray-100 border border-gray-200">
                  <span className="text-xs text-gray-600">QQQ: </span>
                  <span className={`text-xs font-semibold ${
                    data.qqq_return > 0 ? 'text-[#0AAE84]' : 'text-red-600'
                  }`}>
                    {data.qqq_return > 0 ? '+' : ''}{(data.qqq_return * 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sparkline */}
        <div className="h-10 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLine data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={isPositive ? '#0AAE84' : '#EF4444'}
                strokeWidth={2}
                dot={false}
              />
            </RechartsLine>
          </ResponsiveContainer>
        </div>

        {/* Micro-stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-[#F8F9FA] border border-[#E5E7EB]">
            <p className="text-xs text-[#374151] mb-1">Win Rate</p>
            <p className="text-lg font-bold text-[#111827]">
              {(data.win_rate * 100).toFixed(0)}%
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F8F9FA] border border-[#E5E7EB]">
            <p className="text-xs text-[#374151] mb-1">Best Trade</p>
            <p className="text-lg font-bold text-[#22C55E]">
              +{(data.best_trade * 100).toFixed(1)}%
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#F8F9FA] border border-[#E5E7EB]">
            <p className="text-xs text-[#374151] mb-1">Worst Trade</p>
            <p className="text-lg font-bold text-[#EF4444]">
              {(data.worst_trade * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* CTA */}
        <Button
          asChild
          variant="ghost"
          className="w-full justify-between text-[#0AAE84] hover:text-[#0AAE84]/90 hover:bg-[#0AAE84]/5"
        >
          <Link href="/performance">
            See Full Performance
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function HelpCircleButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="p-1 hover:bg-[#E5E7EB] rounded-full transition-colors"
          aria-label="How is performance calculated?"
        >
          <HelpCircle className="h-5 w-5 text-[#374151]" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-white border-[#E5E7EB]">
        <DialogHeader>
          <DialogTitle className="text-[#111827]">
            How is this performance calculated?
          </DialogTitle>
        </DialogHeader>
        
        <Separator className="bg-[#E5E7EB]" />
        
        <div className="space-y-4 text-[#111827]">
          <p className="text-sm text-[#374151]">
            Marild uses a standardized model portfolio to measure how AI signals perform.
          </p>

          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Starting balance:</span>
              <span className="text-[#374151]">$100,000 (virtual)</span>
            </div>
            
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Position size:</span>
              <span className="text-[#374151]">5% of the portfolio per signal</span>
            </div>
            
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Entry:</span>
              <span className="text-[#374151]">Close price at the moment the signal was generated</span>
            </div>
            
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Exit:</span>
              <span className="text-[#374151]">Next opposite signal (BUY closes on SELL)</span>
            </div>
            
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Fallback exit:</span>
              <span className="text-[#374151]">
                If no opposite signal appears within 10 candles, we exit at that candle’s close.
              </span>
            </div>
            
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Take-profit:</span>
              <span className="text-[#374151]">
                TP levels do <em>not</em> affect the equity curve. Instead, we track how often TP was hit (TP Hit Rate).
              </span>
            </div>
            
            <div className="flex gap-3">
              <span className="text-[#0AAE84] font-semibold min-w-[140px]">Benchmark:</span>
              <span className="text-[#374151]">
                Performance is compared to SPY or QQQ starting at the same value.
              </span>
            </div>
          </div>

          <Separator className="bg-[#E5E7EB]" />

          <p className="text-xs text-[#374151] italic">
            Performance is hypothetical and for informational purposes only. It does not represent financial advice.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
