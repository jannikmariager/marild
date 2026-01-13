'use client';

import { AlertCircle, Info, Ban } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDailyLimitStatus } from '@/hooks/useDailyLimitStatus';

interface DailyLimitBannerProps {
  onUpgradeClick?: () => void;
}

/**
 * Daily usage limit banner for free tier users
 * Feature Flag: FEATURE_FREE_TIER_LIMITS (backend must be enabled)
 * 
 * Shows:
 * - Red banner when limits exhausted
 * - Orange banner when running low (<3 remaining)
 * - Blue info banner for normal usage
 * - Hidden for Pro/Trial users
 */
export function DailyLimitBanner({ onUpgradeClick }: DailyLimitBannerProps) {
  const limits = useDailyLimitStatus();

  // Hide for Pro/Trial users
  if (!limits.isFreeTier || limits.isLoading) {
    return null;
  }

  // Check limits state
  const hasZeroLimits = 
    (limits.remainingSignals !== null && limits.remainingSignals <= 0) ||
    (limits.remainingSMC !== null && limits.remainingSMC <= 0) ||
    (limits.remainingChat !== null && limits.remainingChat <= 0);

  const hasLowLimits = 
    (limits.remainingSignals !== null && limits.remainingSignals < 3) ||
    (limits.remainingSMC !== null && limits.remainingSMC < 3) ||
    (limits.remainingChat !== null && limits.remainingChat < 3);

  // Build usage message
  const parts: string[] = [];
  if (limits.remainingSignals !== null) {
    parts.push(`${limits.remainingSignals} signals`);
  }
  if (limits.remainingSMC !== null) {
    parts.push(`${limits.remainingSMC} SMC`);
  }
  if (limits.remainingChat !== null) {
    parts.push(`${limits.remainingChat} chat`);
  }
  const usageMessage = parts.length > 0 ? `${parts.join(', ')} remaining today` : '';

  // Critical (exhausted)
  if (hasZeroLimits) {
    return (
      <Alert variant="destructive" className="mb-4">
        <Ban className="h-4 w-4" />
        <AlertTitle>Daily limit reached</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>Upgrade to Pro for unlimited access</span>
          {onUpgradeClick && (
            <Button 
              onClick={onUpgradeClick} 
              variant="destructive"
              size="sm"
              className="ml-4"
            >
              Upgrade
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Warning (running low)
  if (hasLowLimits) {
    return (
      <Alert className="mb-4 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
        <AlertCircle className="h-4 w-4 text-orange-700 dark:text-orange-400" />
        <AlertTitle className="text-orange-900 dark:text-orange-100">
          Running low on requests
        </AlertTitle>
        <AlertDescription className="flex items-center justify-between text-orange-800 dark:text-orange-200">
          <span>{usageMessage}</span>
          {onUpgradeClick && (
            <Button 
              onClick={onUpgradeClick} 
              variant="outline"
              size="sm"
              className="ml-4 border-orange-300 bg-orange-100 hover:bg-orange-200 dark:border-orange-700 dark:bg-orange-900"
            >
              Upgrade
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Info (normal usage)
  return (
    <Alert className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
      <Info className="h-4 w-4 text-blue-700 dark:text-blue-400" />
      <AlertTitle className="text-blue-900 dark:text-blue-100">
        Daily usage
      </AlertTitle>
      <AlertDescription className="text-blue-800 dark:text-blue-200">
        {usageMessage}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Compact inline indicator for smaller spaces
 */
interface CompactDailyLimitIndicatorProps {
  className?: string;
}

export function CompactDailyLimitIndicator({ className }: CompactDailyLimitIndicatorProps) {
  const limits = useDailyLimitStatus();

  // Hide for Pro/Trial users
  if (!limits.isFreeTier || limits.isLoading) {
    return null;
  }

  const hasZeroLimits = limits.remainingSignals !== null && limits.remainingSignals <= 0;

  return (
    <div className={`inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300 ${className}`}>
      <Info className="h-3 w-3" />
      <span>
        {hasZeroLimits 
          ? 'Limit reached'
          : limits.remainingSignals !== null 
            ? `${limits.remainingSignals} left today`
            : 'Free tier'}
      </span>
    </div>
  );
}
