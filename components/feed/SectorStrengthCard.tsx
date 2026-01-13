'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import { Skeleton } from '@/components/ui/skeleton';
import { timeAgo } from '@/lib/utils/timeAgo';
import { cn } from '@/lib/utils';

interface Sector {
  name: string;
  change: number;
}

interface SectorStrengthData {
  sectors: Sector[];
  updated_at: string;
  access: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export default function SectorStrengthCard() {
  const router = useRouter();
  const [data, setData] = useState<SectorStrengthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSectorStrength();
  }, []);

  async function fetchSectorStrength() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/insights/sector-strength');
      const result = await response.json();

      if (!response.ok && response.status !== 403) {
        throw new Error(result.message || `Failed to fetch: ${response.status}`);
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching sector strength:', err);
      setError(err.message || 'Failed to load sector data');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState error={error} onRetry={fetchSectorStrength} />;
  }

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Sector Strength</h2>
        </div>
        <span className="text-xs text-gray-500">
          Updated {timeAgo(data.updated_at)}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.sectors.map((sec) => (
          <div
            key={sec.name}
            className={cn(
              'rounded-lg p-4 text-left shadow-sm border',
              sec.change > 0
                ? 'bg-[#0AAE84]/10 border-[#0AAE84]/20'
                : sec.change < 0
                  ? 'bg-red-50 border-red-100'
                  : 'bg-gray-50 border-gray-200'
            )}
          >
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-gray-900 text-sm">{sec.name}</span>
              <span
                className={cn(
                  'font-bold text-base',
                  sec.change >= 0 ? 'text-[#0AAE84]' : 'text-red-600'
                )}
              >
                {sec.change >= 0 ? '+' : ''}
                {sec.change.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LoadingState() {
  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Sector Strength</h2>
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </Card>
  );
}

function ErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Sector Strength</h2>
        </div>
      </div>
      <div className="text-center py-8">
        <p className="text-sm text-gray-600 mb-3">{error || 'Failed to load sector data'}</p>
        <Button onClick={onRetry} variant="outline" size="sm">
          Retry
        </Button>
      </div>
    </Card>
  );
}

function LockedState() {
  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6 relative overflow-hidden">
      {/* Blurred content */}
      <div className="opacity-40 pointer-events-none">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Sector Strength</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
        <div className="text-center">
          <Lock className="h-12 w-12 text-gray-700 mx-auto mb-3" />
          <p className="font-semibold mb-2 text-gray-900">Upgrade to PRO</p>
          <p className="text-gray-600 text-sm mb-3">Unlock advanced market insights</p>
          <UpgradeButton className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white" />
        </div>
      </div>
    </Card>
  );
}
