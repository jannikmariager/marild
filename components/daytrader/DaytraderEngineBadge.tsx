'use client';

import { Badge } from '@/components/ui/badge';
import { getEngineVersion, isTickerEnabled } from '@/lib/daytrader-universe';

interface DaytraderEngineBadgeProps {
  symbol: string;
  engineVersion?: string | null;
  size?: 'sm' | 'md' | 'lg';
  showFullLabel?: boolean;
  className?: string;
}

/**
 * Displays DAYTRADER engine version badge
 * - v3: Yellow "Momentum Engine v3" (#FFD966)
 * - v3.5: Blue "Precision Engine v3.5" (#6EC1E4)
 * - v4: Green "Liquidity Engine v4" (#10B981)
 * - Disabled: Grey "Not supported"
 */
export function DaytraderEngineBadge({
  symbol,
  engineVersion,
  size = 'md',
  showFullLabel = false,
  className = '',
}: DaytraderEngineBadgeProps) {
  // Get engine version from routing table if not provided
  const resolvedEngineVersion = engineVersion || getEngineVersion(symbol);
  const disabled = !resolvedEngineVersion || !isTickerEnabled(symbol);

  // Handle disabled tickers
  if (disabled) {
    return (
      <Badge
        variant="outline"
        className={`border-gray-300 text-gray-500 bg-gray-50 ${getSizeClasses(size)} ${className}`}
      >
        Not supported
      </Badge>
    );
  }

  // Determine styling based on engine version
  let bgColor: string;
  let textColor: string;
  let borderColor: string;
  let shortLabel: string;
  let fullLabel: string;
  
  if (resolvedEngineVersion === 'V3') {
    bgColor = 'bg-[#FFD966]';
    textColor = 'text-amber-900';
    borderColor = 'border-amber-300';
    shortLabel = 'v3';
    fullLabel = 'Momentum Engine v3';
  } else if (resolvedEngineVersion === 'V3_5') {
    bgColor = 'bg-[#6EC1E4]';
    textColor = 'text-blue-900';
    borderColor = 'border-blue-300';
    shortLabel = 'v3.5';
    fullLabel = 'Precision Engine v3.5';
  } else if (resolvedEngineVersion === 'V4') {
    bgColor = 'bg-[#10B981]';
    textColor = 'text-green-900';
    borderColor = 'border-green-300';
    shortLabel = 'v4';
    fullLabel = 'Liquidity Engine v4';
  } else {
    // Default fallback
    bgColor = 'bg-gray-100';
    textColor = 'text-gray-700';
    borderColor = 'border-gray-300';
    shortLabel = 'unknown';
    fullLabel = 'Unknown Engine';
  }
  
  const label = showFullLabel ? fullLabel : shortLabel;

  return (
    <Badge
      variant="outline"
      className={`${bgColor} ${textColor} ${borderColor} font-semibold ${getSizeClasses(size)} ${className}`}
    >
      {label}
    </Badge>
  );
}

function getSizeClasses(size: 'sm' | 'md' | 'lg'): string {
  switch (size) {
    case 'sm':
      return 'text-[10px] px-2 py-0.5 rounded-md';
    case 'md':
      return 'text-[11px] px-2.5 py-1 rounded-lg';
    case 'lg':
      return 'text-xs px-3 py-1.5 rounded-lg';
  }
}
