'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Activity, AlertCircle } from 'lucide-react';
import ProLockedCard from '@/components/feed/ProLockedCard';

interface MarketOverviewData {
  headline: string;
  summary_label: 'bullish' | 'neutral' | 'bearish';
  market_trend: string[];
  volatility_risk: string[];
  sentiment_signals: string[];
  access?: {
    is_locked: boolean;
  };
}

export function MarketOverview() {
  const [data, setData] = useState<MarketOverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    fetchMarketOverview();
  }, []);

  async function fetchMarketOverview() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai-market-summary/latest');
      const result = await response.json();

      if (result?.access?.is_locked) {
        setIsLocked(true);
        setData(null);
        return;
      }

      if (response.status === 404) {
        setError('No data available');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch market overview');
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching market overview:', err);
      setError(err.message || 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-64 flex-shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }


  if (isLocked) {
    return (
      <ProLockedCard
        isLocked
        featureName="AI Market Overview"
        description="View real-time AI commentary, volatility, and sentiment signals across the market."
      >
        <div className="flex gap-3 w-full">
          <Card className="p-4 rounded-xl border-gray-200 shadow-sm" style={{ flex: '3 1 0%' }}>
            <div className="flex flex-col h-full gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Market Today</span>
              <div className="space-y-1">
                <div className="h-2 w-3/4 bg-gray-200 rounded" />
                <div className="h-2 w-full bg-gray-200 rounded" />
                <div className="h-2 w-2/3 bg-gray-200 rounded" />
              </div>
            </div>
          </Card>
        </div>
      </ProLockedCard>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-4 bg-red-50 border-red-200 rounded-xl">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm font-medium">{error || 'Failed to load market overview'}</span>
        </div>
      </Card>
    );
  }

  const getSentimentColor = (label: string) => {
    switch (label) {
      case 'bullish':
        return 'bg-[#0AAE84]/10 text-[#0AAE84] border-[#0AAE84]/20';
      case 'bearish':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      default:
        return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    }
  };

  // Create KPI chips from market data
  const kpiChips = [
    {
      icon: <TrendingUp className="h-4 w-4" />,
      label: 'Market Sentiment',
      value: data.summary_label.toUpperCase(),
      color: getSentimentColor(data.summary_label),
    },
    {
      icon: <Activity className="h-4 w-4" />,
      label: 'Trend',
      value: data.market_trend[0]?.split(':')[0] || 'Mixed',
      color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    },
    {
      icon: <AlertCircle className="h-4 w-4" />,
      label: 'Volatility',
      value: data.volatility_risk[0]?.split(':')[0] || 'Moderate',
      color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    },
  ];

  return (
    <div className="flex gap-3 w-full">
      {/* Headline Card - wider */}
      <Card className="p-4 rounded-xl border-gray-200 shadow-sm" style={{ flex: '3 1 0%' }}>
        <div className="flex flex-col h-full">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Market Today
          </span>
          <span className="text-sm text-gray-900 leading-snug line-clamp-4" title={data.headline}>
            {data.headline}
          </span>
        </div>
      </Card>

      {/* Market Sentiment */}
      <Card className={`p-4 rounded-xl border shadow-sm ${kpiChips[0].color}`} style={{ flex: '1 1 0%' }}>
        <div className="flex items-center gap-2 mb-1">
          {kpiChips[0].icon}
          <span className="text-xs font-semibold uppercase tracking-wide">
            {kpiChips[0].label}
          </span>
        </div>
        <div className="text-sm font-bold mt-1">{kpiChips[0].value}</div>
      </Card>

      {/* Trend */}
      <Card className={`p-4 rounded-xl border shadow-sm ${kpiChips[1].color}`} style={{ flex: '1 1 0%' }}>
        <div className="flex items-center gap-2 mb-1">
          {kpiChips[1].icon}
          <span className="text-xs font-semibold uppercase tracking-wide">
            {kpiChips[1].label}
          </span>
        </div>
        <div className="text-sm font-bold mt-1">{kpiChips[1].value}</div>
      </Card>

      {/* Volatility */}
      <Card className={`p-4 rounded-xl border shadow-sm ${kpiChips[2].color}`} style={{ flex: '1 1 0%' }}>
        <div className="flex items-center gap-2 mb-1">
          {kpiChips[2].icon}
          <span className="text-xs font-semibold uppercase tracking-wide">
            {kpiChips[2].label}
          </span>
        </div>
        <div className="text-sm font-bold mt-1">{kpiChips[2].value}</div>
      </Card>
    </div>
  );
}
