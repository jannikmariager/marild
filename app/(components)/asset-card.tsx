'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkline } from '@/components/ui/Sparkline';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { timeAgo } from '@/lib/utils/timeAgo';
import { cn } from '@/lib/utils';

export type AssetSentiment = 'bullish' | 'bearish' | 'neutral';

export interface AssetCardProps {
  symbol: string;
  name?: string;
  price: number | null;
  changePct: number | null;
  sparkline: number[] | null;
  volume?: number | null;
  latestSignalType?: 'buy' | 'sell' | 'neutral' | null;
  latestSignalConfidence?: number | null;
  sentiment?: AssetSentiment | null;
  lastUpdated?: string | null;
  proRequired?: boolean;
}

export function AssetCard({
  symbol,
  name,
  price,
  changePct,
  sparkline,
  volume,
  latestSignalType,
  latestSignalConfidence,
  sentiment,
  lastUpdated,
  proRequired = false,
}: AssetCardProps) {
  const router = useRouter();

  const isUp = (changePct ?? 0) > 0;
  const isDown = (changePct ?? 0) < 0;

  const handleClick = () => {
    if (proRequired) return;
    router.push(`/markets/${symbol}`);
  };

  const sentimentLabel = sentiment ? sentiment.charAt(0).toUpperCase() + sentiment.slice(1) : null;

  const formatSignal = () => {
    if (!latestSignalType) return 'No signal';
    const label = latestSignalType.toUpperCase();
    if (!latestSignalConfidence && latestSignalConfidence !== 0) return label;
    return `${label} ${latestSignalConfidence.toFixed(0)}%`;
  };

  const formatVolume = (vol: number | null | undefined) => {
    if (!vol) return '-';
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return vol.toString();
  };

  return (
    <div className="relative">
      <Card
        className="rounded-xl border border-gray-200 hover:bg-gray-50 transition-all cursor-pointer"
        onClick={handleClick}
      >
        <div className="flex items-center gap-6 h-[30px] px-4">
          {/* Column 1: Symbol + name + optional sentiment */}
          <div className="w-32 min-w-[8rem] flex-shrink-0 flex flex-col justify-center">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-bold text-gray-900 truncate">{symbol}</span>
              {sentimentLabel && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 font-semibold rounded-full',
                    sentiment === 'bullish' && 'border-[#0AAE84] text-[#0AAE84] bg-[#0AAE84]/5',
                    sentiment === 'bearish' && 'border-red-600 text-red-600 bg-red-50',
                    sentiment === 'neutral' && 'border-gray-400 text-gray-600 bg-gray-50'
                  )}
                >
                  {sentimentLabel}
                </Badge>
              )}
            </div>
            {name && name !== symbol && (
              <span className="text-[11px] text-gray-500 truncate max-w-[11rem]">{name}</span>
            )}
          </div>

          {/* Column 2: Price */}
          <div className="w-24 flex-shrink-0 text-[13px] font-semibold text-gray-900">
            {price == null ? '-' : price.toFixed(2)}
          </div>

        {/* Column 3: % Change */}
          <div
            className={cn(
              'w-20 flex-shrink-0 text-[13px] font-medium',
              isUp && 'text-[#0AAE84]',
              isDown && 'text-red-600',
              !isUp && !isDown && 'text-gray-500'
            )}
          >
            {changePct == null ? '-' : `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`}
          </div>

          {/* Column 4: Latest Signal */}
          <div className="w-32 flex-shrink-0 text-[12px] text-gray-700">
            {formatSignal()}
          </div>

          {/* Column 5: Volume */}
          <div className="w-24 flex-shrink-0 text-[12px] text-right text-gray-500">
            {formatVolume(volume ?? null)}
          </div>

          {/* Column 6: Sparkline */}
          <div className="flex-1 flex items-center justify-center">
            {sparkline && sparkline.length >= 3 ? (
              <Sparkline
                points={sparkline}
                width={90}
                height={24}
                stroke={isUp ? '#0AAE84' : isDown ? '#dc2626' : '#6A7FDB'}
                strokeWidth={1.3}
              />
            ) : (
              <div className="w-24 h-5 bg-gray-100 rounded" />
            )}
          </div>

          {/* Column 5: Updated timestamp */}
          <div className="w-32 flex-shrink-0 text-right text-[11px] text-gray-400">
            {lastUpdated ? `Updated ${timeAgo(lastUpdated)}` : ''}
          </div>
        </div>
      </Card>

      {proRequired && (
        <div className="absolute inset-0 rounded-xl bg-white/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-gray-800 text-xs font-semibold">
            <Lock className="w-4 h-4" />
            <Badge variant="outline" className="border-gray-500 text-gray-800 px-2 py-0.5 text-[10px]">
              PRO
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}
