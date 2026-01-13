'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { TopAiTradeDto } from '@/app/api/dashboard/top-ai-trades/route';
import { useUser } from '@/components/providers/user-provider';
import { getDevSubscriptionStatus } from '@/lib/subscription/devOverride';

interface ApiResponse {
  trades: TopAiTradeDto[];
}

export function TopAiTradesCard() {
  const user = useUser();
  const devStatus = getDevSubscriptionStatus();
  const isPro = devStatus?.isPro || user?.subscription_tier === 'pro';

  const [data, setData] = useState<TopAiTradeDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/dashboard/top-ai-trades');
        const payload: ApiResponse = await res.json();
        if (!res.ok) {
          throw new Error((payload as any)?.message || 'Failed to load top AI trades');
        }
        if (isMounted) {
          setData(payload.trades || []);
        }
      } catch (e: any) {
        console.error('[TopAiTradesCard] load error', e);
        if (isMounted) setError(e.message || 'Failed to load top AI trades');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const renderRow = (trade: TopAiTradeDto) => {
    const isLong = trade.direction === 'LONG';
    const outcomeLabel = trade.outcome_type === 'TP' ? 'TP hit' : trade.outcome_type === 'SL' ? 'SL hit' : 'Closed';
    const outcomeColor = trade.outcome_type === 'SL' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    const pct = trade.realized_return ?? 0;
    const pctColor = pct >= 0 ? 'text-emerald-600' : 'text-red-600';

    return (
      <div
        key={trade.id}
        className="w-full flex items-center gap-4 px-4 py-3 border-b border-gray-100 text-left"
      >
        {/* Ticker */}
        <div className="w-20 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-900">{trade.ticker}</span>
        </div>

        {/* Direction (own column, fully aligned) */}
        <div className="w-24 flex-shrink-0">
          <Badge
            variant="outline"
            className={`w-full justify-center text-[10px] font-semibold px-1.5 py-0.5 flex items-center gap-1 ${
              isLong ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-red-300 text-red-700 bg-red-50'
            }`}
          >
            {isLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isLong ? 'LONG' : 'SHORT'}
          </Badge>
        </div>

        {/* Return */}
        <div className={`w-24 text-sm font-semibold ${pctColor}`}>
          {pct >= 0 ? '+' : ''}
          {pct.toFixed(1)}%
        </div>

        {/* Outcome + duration */}
        <div className="flex items-center gap-2 w-40">
          <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${outcomeColor}`}>
            {outcomeLabel}
          </Badge>
          {trade.duration_to_outcome && (
            <span className="text-[11px] text-gray-500">{trade.duration_to_outcome}</span>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Top AI Trades</h2>
            <p className="text-xs text-gray-500">Best performing model trades (last 7 days)</p>
          </div>
        </div>
        <div className="space-y-2 mt-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-9 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  // FREE users should see a teaser instead of live trade list
  if (!isPro) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Top AI Trades</h2>
            <p className="text-xs text-gray-500">Best performing model trades (last 7 days)</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-2">
          See how the model portfolio has traded the top symbols over the last week.
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Subscribe to Marild PRO to unlock live Top AI Trades, including entry, exit and P&L per trade.
        </p>
        <UpgradeButton
          className="w-full text-xs font-medium text-white bg-[#0AAE84] hover:bg-[#0AAE84]/90 rounded-md py-2"
        >
          Upgrade to PRO
        </UpgradeButton>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Top AI Trades</h2>
            <p className="text-xs text-gray-500">Best performing model trades (last 7 days)</p>
          </div>
        </div>
        <p className="text-sm text-red-600">{error}</p>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Top AI Trades</h2>
            <p className="text-xs text-gray-500">Best performing model trades (last 7 days)</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">No completed AI trades in this period yet.</p>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Top AI Trades</h2>
          <p className="text-xs text-gray-500">Best performing model trades (last 7 days)</p>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {data.map((trade) => renderRow(trade))}
      </div>
    </Card>
  );
}
