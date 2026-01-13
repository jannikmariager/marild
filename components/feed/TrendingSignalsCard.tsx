'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, ArrowUpRight, ArrowDownRight, Lock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { timeAgo } from '@/lib/utils/timeAgo';
import { DaytraderEngineBadge } from '@/components/daytrader/DaytraderEngineBadge';

interface TrendingSignal {
  symbol: string;
  action: 'buy' | 'sell';
  confidence: number;
  timeframe: string;
  change_today: number;
  summary: string;
  updated_at: string;
  engine_version?: 'V3' | 'V3_5';
}

interface TrendingSignalsData {
  signals: TrendingSignal[];
  access: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export default function TrendingSignalsCard() {
  const router = useRouter();
  const [data, setData] = useState<TrendingSignalsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrendingSignals();
  }, []);

  async function fetchTrendingSignals() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/tradesignals/trending');
      const result = await response.json();

      // Handle empty signals as success (not error)
      if (result.signals && result.signals.length === 0) {
        setData(result);
        setIsLoading(false);
        return;
      }

      if (response.status === 404 || result.error === 'NO_DATA') {
        setData({ signals: [], access: { is_locked: false, has_pro_access: true } });
        setIsLoading(false);
        return;
      }

      if (!response.ok && response.status !== 403) {
        console.error('[Trending Signals] API Error:', result);
        throw new Error(result.message || `Failed to fetch: ${response.status}`);
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching trending signals:', err);
      setError(err.message || 'Failed to load signals');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Top Signals</h2>
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <ul className="divide-y divide-gray-100">
          {[...Array(5)].map((_, i) => (
            <li key={i} className="py-4">
              <Skeleton className="h-16 w-full" />
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Top Signals</h2>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <p className="text-sm text-red-600">{error || 'Unable to load signals'}</p>
        </div>
      </Card>
    );
  }

  const latestSignalTime = data.signals.length > 0 ? data.signals[0].updated_at : new Date().toISOString();

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Top Signals</h2>
        </div>
        <span className="text-xs text-gray-500">
          Updated {timeAgo(latestSignalTime)}
        </span>
      </div>

      {data.signals.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No trending signals available</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {data.signals.map((signal) => (
              <li key={`${signal.symbol}-${signal.updated_at}`}>
                <button
                  onClick={() => router.push(`/tradesignals?symbol=${signal.symbol}`)}
                  className="w-full py-4 flex items-center justify-between hover:bg-gray-50 transition rounded-lg px-2"
                >
                  {/* LEFT */}
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 text-base">{signal.symbol}</span>
                      <Badge
                        variant="outline"
                        className={
                          signal.action === 'buy'
                            ? 'border-[#0AAE84] text-[#0AAE84] bg-[#0AAE84]/5'
                            : 'border-red-500 text-red-600 bg-red-50'
                        }
                      >
                        {signal.action.toUpperCase()}
                      </Badge>
                      <DaytraderEngineBadge symbol={signal.symbol} engineVersion={signal.engine_version} size="sm" />
                    </div>
                    <p className="text-xs text-gray-500">
                      {signal.confidence}% confidence • {signal.timeframe} • {signal.summary}
                    </p>
                  </div>

                  {/* RIGHT */}
                  <div className="flex items-center gap-1 ml-4">
                    <span
                      className={
                        signal.change_today >= 0
                          ? 'text-[#0AAE84] font-medium'
                          : 'text-red-600 font-medium'
                      }
                    >
                      {signal.change_today >= 0 ? '+' : ''}
                      {signal.change_today.toFixed(2)}%
                    </span>
                    {signal.change_today >= 0 ? (
                      <ArrowUpRight className="w-4 h-4 text-[#0AAE84]" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4 text-red-600" />
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <Button
              variant="ghost"
              className="w-full text-[#0AAE84] hover:text-[#0AAE84]/90 hover:bg-[#0AAE84]/5"
              onClick={() => router.push('/tradesignals')}
            >
              View All Signals →
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
