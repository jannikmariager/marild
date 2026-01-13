'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';

interface TodayActivitySummary {
  totalTrades: number;
  winners: number;
  losers: number;
  best?: { symbol: string; pnl_pct: number | null };
  worst?: { symbol: string; pnl_pct: number | null };
}

interface TodayActivityResponse {
  access: { is_locked: boolean };
  summary: TodayActivitySummary | null;
}

export default function TradeTable() {
  const router = useRouter();
  const [data, setData] = useState<TodayActivityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadToday();
  }, []);

  async function loadToday() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/performance/today-activity');
      if (!response.ok) {
        throw new Error(`Failed to load today activity: ${response.status}`);
      }
      const json: TodayActivityResponse = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load today activity');
    } finally {
      setIsLoading(false);
    }
  }

  const isLocked = data?.access.is_locked;
  const summary = data?.summary || null;

  // PRO-locked view
  if (isLocked) {
    return (
      <Card className="border-gray-200">
        <CardContent className="p-5">
          <h3 className="text-[16px] font-semibold text-gray-900 mb-2">Today&apos;s Activity</h3>
          <p className="text-[14px] text-gray-700">
            Upgrade to PRO to view live AI trade performance.
          </p>
          <UpgradeButton className="mt-3 text-[14px]" size="sm">
            Upgrade to PRO →
          </UpgradeButton>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-gray-200 rounded-xl bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-[16px] font-semibold text-gray-900">
          Today&apos;s Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-1">
        {isLoading ? (
          <p className="text-[14px] text-gray-600">Loading today&apos;s activity…</p>
        ) : error ? (
          <p className="text-[14px] text-red-600">{error}</p>
        ) : !summary ? (
          <p className="text-[14px] text-gray-700">
            No confirmed trades yet — this section will update automatically as soon as the AI
            executes new entries.
          </p>
        ) : (
          <>
            <p className="text-[14px] text-gray-700">
              {summary.totalTrades} confirmed trades
            </p>
            <p className="text-[14px] text-gray-700 mt-1">
              Winners: {summary.winners} • Losers: {summary.losers}
            </p>
            {summary.best && (
              <p className="text-[14px] text-gray-700 mt-1">
                Best: {summary.best.symbol}{' '}
                {summary.best.pnl_pct !== null
                  ? `${summary.best.pnl_pct >= 0 ? '+' : ''}${summary.best.pnl_pct.toFixed(2)}%`
                  : 'n/a'}
              </p>
            )}
            {summary.worst && (
              <p className="text-[14px] text-gray-700 mt-1">
                Worst: {summary.worst.symbol}{' '}
                {summary.worst.pnl_pct !== null
                  ? `${summary.worst.pnl_pct >= 0 ? '+' : ''}${summary.worst.pnl_pct.toFixed(2)}%`
                  : 'n/a'}
              </p>
            )}

            <button
              type="button"
              className="text-blue-600 hover:underline text-[14px] mt-3 inline-block"
              onClick={() => router.push('/tradesignals?tab=performance')}
            >
              View all trades →
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
