'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import ProLockedCard from '@/components/feed/ProLockedCard';

interface Sector {
  name: string;
  change: number;
}

interface SectorData {
  sectors: Sector[];
  updated_at: string;
  access?: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export function SectorHeatmap() {
  const router = useRouter();
  const [data, setData] = useState<SectorData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    fetchSectorData();
  }, []);

  async function fetchSectorData() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/insights/sector-strength');
      const result = await response.json();

      if (result?.access?.is_locked) {
        setIsLocked(true);
        setData(null);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch sector data');
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching sector data:', err);
      setError(err.message || 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="rounded-xl border-gray-200 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Sector Performance</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLocked) {
    return (
      <ProLockedCard
        isLocked
        featureName="Sector Heatmap"
        description="Unlock sector trends, performance dispersion, and rotation insights updated in real time."
      >
        <Card className="rounded-xl border-gray-200 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
              <h2 className="text-lg font-semibold text-gray-900">Sector Performance</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </ProLockedCard>
    );
  }

  // Define sectors to always show
  const defaultSectors = [
    { name: 'Technology', change: 0 },
    { name: 'Financials', change: 0 },
    { name: 'Healthcare', change: 0 },
    { name: 'Energy', change: 0 },
    { name: 'Consumer', change: 0 },
    { name: 'Industrials', change: 0 },
  ];

  const sectorsToDisplay = (error || !data) ? defaultSectors : data.sectors;
  const hasNoData = error || !data;

  return (
    <Card className="rounded-xl border-gray-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#0AAE84]" />
            <h2 className="text-lg font-semibold text-gray-900">Sector Performance</h2>
          </div>
          {!hasNoData && data?.updated_at && (
            <span className="text-xs text-gray-500">
              Updated {new Date(data.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {sectorsToDisplay.map((sector) => (
            <div
              key={sector.name}
              className={cn(
                'rounded-lg p-4 text-left shadow-sm border',
                hasNoData
                  ? 'bg-gray-50 border-gray-200'
                  : cn(
                      sector.change > 0
                        ? 'bg-[#0AAE84]/10 border-[#0AAE84]/20'
                        : sector.change < 0
                          ? 'bg-red-50 border-red-100'
                          : 'bg-gray-50 border-gray-200'
                    )
              )}
            >
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-gray-900 text-sm">
                  {sector.name}
                </span>
                {hasNoData ? (
                  <span className="text-xs text-gray-500">No data</span>
                ) : (
                  <span
                    className={cn(
                      'font-bold text-lg',
                      sector.change >= 0 ? 'text-[#0AAE84]' : 'text-red-600'
                    )}
                  >
                    {sector.change >= 0 ? '+' : ''}
                    {sector.change.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
