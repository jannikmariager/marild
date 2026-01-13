'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import Link from 'next/link';

interface UniverseTicker {
  ticker: string;
  live_trades: number | null;
  live_net_pnl: number | null;
  live_win_rate: number | null;
  horizons: string[];
}

interface ApiResponse {
  tickers: UniverseTicker[];
  access?: { is_locked: boolean };
  error?: string;
  message?: string;
}

export function PerformanceUniverseCard() {
  const [data, setData] = useState<UniverseTicker[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    fetchUniverse();
  }, []);

  async function fetchUniverse() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/performance/universe');

      const payload: ApiResponse = await response.json().catch(() => ({ tickers: [] }));

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          if (payload.access?.is_locked || payload.error === 'LOCKED') {
            setIsLocked(true);
            setData([]);
            return;
          }
        }

        throw new Error(payload.message || 'Failed to load performance universe');
      }

      setIsLocked(Boolean(payload.access?.is_locked));
      setData(payload.tickers || []);
    } catch (err: any) {
      console.error('[PerformanceUniverseCard] Error:', err);
      setError(err.message || 'Failed to load performance universe');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Approved performance tickers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isLocked) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Approved performance tickers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[#374151]">
            See which tickers passed our engine’s performance filters (expectancy, win rate, drawdown).
          </p>
          <p className="text-sm text-[#6B7280]">
            Upgrade to PRO to unlock the full performance universe.
          </p>
          <UpgradeButton
            className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white w-full justify-center text-xs font-medium py-2"
          >
            Upgrade to PRO
          </UpgradeButton>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Approved performance tickers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#6B7280] mb-2">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUniverse}
            className="text-[#111827] border-[#E5E7EB]"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const tickers = data || [];
  
  // Sort by live P&L (descending) to match overview page
  const sorted = [...tickers].sort((a, b) => {
    const pnlA = a.live_net_pnl ?? -Infinity;
    const pnlB = b.live_net_pnl ?? -Infinity;
    return pnlB - pnlA;
  });
  
  const topTickers = sorted.slice(0, 8);

  if (topTickers.length === 0) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Approved performance tickers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#6B7280]">
            No approved performance tickers yet. Once our engine finishes evaluation, they will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-[#111827]">Approved performance tickers</CardTitle>
          <span className="text-xs text-[#6B7280]">Top {topTickers.length} by live P&L</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-xs text-[#6B7280]">
                <th className="text-left py-2">Ticker</th>
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Live trades</th>
                <th className="text-right py-2">Live P&L</th>
                <th className="text-right py-2">Live win%</th>
              </tr>
            </thead>
            <tbody>
              {topTickers.map((t) => {
                const status = (t.horizons?.length ?? 0) > 0 ? 'Active' : 'Paused';
                const statusColor = status === 'Active' ? 'text-green-600' : 'text-gray-400';
                
                return (
                  <tr key={t.ticker} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="py-1 font-mono text-[#111827]">{t.ticker}</td>
                    <td className={`py-1 text-left text-xs font-medium ${statusColor}`}>{status}</td>
                    <td className="py-1 text-right text-[#111827]">{t.live_trades ?? 0}</td>
                    <td className="py-1 text-right text-[#111827]">
                      {typeof t.live_net_pnl === 'number'
                        ? `${t.live_net_pnl >= 0 ? '+' : ''}$${Math.round(t.live_net_pnl).toLocaleString()}`
                        : '—'}
                    </td>
                    <td className="py-1 text-right text-[#111827]">
                      {t.live_win_rate != null
                        ? `${(t.live_win_rate * 100).toFixed(0)}%`
                        : t.live_trades && t.live_trades > 0
                        ? '100%'
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button
          asChild
          variant="ghost"
          className="w-full justify-between text-[#0AAE84] hover:text-[#0AAE84]/90 hover:bg-[#0AAE84]/5"
        >
          <Link href="/performance/overview">
            See full performance breakdown
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
