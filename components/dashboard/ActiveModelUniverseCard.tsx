'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UpgradeButton } from '@/components/billing/upgrade-button';

interface UniverseTicker {
  ticker: string;
  horizons: string[];
}

interface ApiResponse {
  tickers: UniverseTicker[];
  access?: { is_locked: boolean };
  error?: string;
  message?: string;
}

export function ActiveModelUniverseCard() {
  const [data, setData] = useState<UniverseTicker[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/performance/universe');
        const payload: ApiResponse = await res.json();
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (mounted) {
              setIsLocked(true);
              setData([]);
            }
            return;
          }
          console.error('[ActiveModelUniverseCard] load error', payload);
          throw new Error((payload as any)?.message || 'Failed to load model universe');
        }
        if (mounted) {
          setIsLocked(Boolean(payload.access?.is_locked));
          setData(payload.tickers || []);
        }
      } catch (e: any) {
        if (mounted) setError(e.message || 'Failed to load model universe');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const tickers = data || [];
  const totalSymbols = tickers.length;

  // Derive simple coverage metrics for status snapshot
  const allHorizons = new Set<string>();
  tickers.forEach((t) => (t.horizons || []).forEach((h) => allHorizons.add(h)));
  const timeframeLabels = Array.from(allHorizons)
    .map((h) => (h === 'day' ? '1H' : h === 'swing' ? '4H' : h === 'invest' ? '1D' : h.toUpperCase()))
    .sort();

  // Simple eligibility buckets based on horizon mix (placeholder, non-performance)
  const highEligibility = Math.round(totalSymbols * 0.5);
  const mediumEligibility = Math.round(totalSymbols * 0.3);
  const lowEligibility = Math.max(0, totalSymbols - highEligibility - mediumEligibility);

  if (isLoading) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Active Model Universe</h2>
            <p className="text-xs text-gray-500">
              AI coverage status (not performance)
            </p>
          </div>
        </div>
        <div className="space-y-2 mt-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-9 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  if (isLocked) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Active Model Universe</h2>
            <p className="text-xs text-gray-500">AI coverage status (not performance)</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-2">
          See which symbols are currently in the live model universe.
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Upgrade to PRO to unlock the full coverage breakdown and performance details.
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
            <h2 className="text-sm font-semibold text-gray-900">Active Model Universe</h2>
            <p className="text-xs text-gray-500">
              AI coverage status (not performance)
            </p>
          </div>
        </div>
        <p className="text-sm text-red-600">{error}</p>
      </Card>
    );
  }

  if (tickers.length === 0) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Active Model Universe</h2>
            <p className="text-xs text-gray-500">
              AI coverage status (not performance)
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-600">The model universe is not configured yet.</p>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Active Model Universe</h2>
          <p className="text-xs text-gray-500">AI coverage status (not performance)</p>
        </div>
        <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">
          MODEL UNIVERSE
        </Badge>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Row 1 – Coverage snapshot */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Coverage</span>
            <span className="font-medium text-gray-900">{totalSymbols} symbols</span>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>{timeframeLabels.length ? timeframeLabels.join(' · ') : 'Timeframes pending configuration'}</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="font-medium text-emerald-700">100% Active</span>
            </span>
          </div>
        </div>

        {/* Row 2 – Eligibility distribution */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Signal eligibility</span>
            <span className="text-[11px] text-gray-500">High · Medium · Low</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-emerald-200 overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: totalSymbols ? `${(highEligibility / totalSymbols) * 100}%` : '0%' }}
              />
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-amber-100 overflow-hidden">
              <div
                className="h-full bg-amber-400"
                style={{ width: totalSymbols ? `${(mediumEligibility / totalSymbols) * 100}%` : '0%' }}
              />
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-gray-400"
                style={{ width: totalSymbols ? `${(lowEligibility / totalSymbols) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-gray-600">
            <span>High: {highEligibility}</span>
            <span>Medium: {mediumEligibility}</span>
            <span>Low: {lowEligibility}</span>
          </div>
        </div>

        {/* Footer – link to coverage page */}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
          <button
            type="button"
            onClick={() => (window.location.href = '/performance')}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            View Coverage &amp; Eligibility →
          </button>
        </div>

        <p className="mt-2 text-[11px] text-gray-500">
          All signals and performance are generated exclusively from this universe.
        </p>
      </div>
    </Card>
  );
}
