'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Sparkles, BarChart3, Lock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { timeAgo } from '@/lib/utils/timeAgo';

interface AIHighlightsData {
  sentiment: 'bullish' | 'neutral' | 'bearish';
  strongest_sector: { name: string; change: number };
  weakest_sector: { name: string; change: number };
  updated_at: string;
  access: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export function AIHighlightsToday() {
  const [data, setData] = useState<AIHighlightsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHighlights();
  }, []);

  async function fetchHighlights() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/insights/ai-highlights');
      const result = await response.json();

      if (response.status === 404 || result.error === 'NO_DATA') {
        setError('No highlights available yet. Check back later.');
        setIsLoading(false);
        return;
      }

      if (!response.ok && response.status !== 403) {
        throw new Error(result.message || `Failed to fetch: ${response.status}`);
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching AI highlights:', err);
      setError(err.message || 'Failed to load highlights');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Highlights Today</h2>
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Highlights Today</h2>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <p className="text-sm text-red-600">{error || 'Unable to load highlights'}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Highlights Today</h2>
          </div>
          <p className="text-[11px] text-gray-500">
            All highlights are derived from AI-generated TradeSignals on the 1H timeframe (last 24h).
          </p>
        </div>
        <span className="text-xs text-gray-500">
          Updated {timeAgo(data.updated_at)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sentiment */}
        <Card className="border border-gray-200 p-4 rounded-lg bg-white">
          <p className="text-xs text-gray-500">AI Sentiment</p>
          <div className="flex items-center gap-2 mt-1">
            <BarChart3 className="w-4 h-4 text-[#0AAE84]" />
            <span className="font-semibold text-gray-900 uppercase">
              {data.sentiment}
            </span>
          </div>
        </Card>

        {/* Strongest Sector */}
        <Card className="border border-gray-200 p-4 rounded-lg bg-white">
          <p className="text-xs text-gray-500">Strongest Sector</p>
          <div className="flex items-center justify-between mt-1">
            <span className="font-semibold text-gray-900">{data.strongest_sector.name}</span>
            <span className="text-[#0AAE84] font-medium">
              +{data.strongest_sector.change.toFixed(2)}%
            </span>
          </div>
        </Card>

        {/* Weakest Sector */}
        <Card className="border border-gray-200 p-4 rounded-lg bg-white">
          <p className="text-xs text-gray-500">Weakest Sector</p>
          <div className="flex items-center justify-between mt-1">
            <span className="font-semibold text-gray-900">{data.weakest_sector.name}</span>
            <span className="text-red-600 font-medium">
              {data.weakest_sector.change.toFixed(2)}%
            </span>
          </div>
        </Card>
      </div>
    </Card>
  );
}
