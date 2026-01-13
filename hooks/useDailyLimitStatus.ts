'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabaseBrowser';

/**
 * Daily usage limits for free tier
 * Feature Flag: FEATURE_FREE_TIER_LIMITS (backend must be enabled)
 */
export interface DailyLimitStatus {
  // null = PRO user (no limits)
  remainingSignals: number | null;
  remainingSMC: number | null;
  remainingChat: number | null;
  isFreeTier: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const FREE_TIER_LIMITS = {
  SIGNALS: 10,
  SMC: 5,
  CHAT: 20,
} as const;

/**
 * Hook to fetch and track daily usage limits
 * 
 * Returns null for remainingX if user is PRO (unlimited)
 * Returns numbers for free tier users
 */
export function useDailyLimitStatus(): DailyLimitStatus {
  const [remainingSignals, setRemainingSignals] = useState<number | null>(null);
  const [remainingSMC, setRemainingSMC] = useState<number | null>(null);
  const [remainingChat, setRemainingChat] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLimits = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const supabase = createClient();
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Not logged in - treat as free tier with full limits
        setRemainingSignals(FREE_TIER_LIMITS.SIGNALS);
        setRemainingSMC(FREE_TIER_LIMITS.SMC);
        setRemainingChat(FREE_TIER_LIMITS.CHAT);
        setIsLoading(false);
        return;
      }

      // Check if PRO user
      const { data: subStatus } = await supabase
        .from('subscription_status')
        .select('tier')
        .eq('user_id', user.id)
        .maybeSingle();

      const isPro = subStatus?.tier === 'pro';

      // PRO users have no limits
      if (isPro) {
        setRemainingSignals(null);
        setRemainingSMC(null);
        setRemainingChat(null);
        setIsLoading(false);
        return;
      }

      // Free tier - fetch today's usage
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD in UTC
      
      const { data: usage, error: usageError } = await supabase
        .from('user_daily_usage')
        .select('signal_requests, smc_requests, ai_chat_requests')
        .eq('user_id', user.id)
        .eq('usage_date', today)
        .maybeSingle();

      if (usageError) {
        console.error('[useDailyLimitStatus] Error fetching usage:', usageError);
        setError('Failed to fetch usage limits');
        setIsLoading(false);
        return;
      }

      // Calculate remaining
      const signalUsage = usage?.signal_requests ?? 0;
      const smcUsage = usage?.smc_requests ?? 0;
      const chatUsage = usage?.ai_chat_requests ?? 0;

      setRemainingSignals(Math.max(0, FREE_TIER_LIMITS.SIGNALS - signalUsage));
      setRemainingSMC(Math.max(0, FREE_TIER_LIMITS.SMC - smcUsage));
      setRemainingChat(Math.max(0, FREE_TIER_LIMITS.CHAT - chatUsage));
      setIsLoading(false);
    } catch (err) {
      console.error('[useDailyLimitStatus] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLimits();
  }, []);

  const isFreeTier = 
    remainingSignals !== null || 
    remainingSMC !== null || 
    remainingChat !== null;

  return {
    remainingSignals,
    remainingSMC,
    remainingChat,
    isFreeTier,
    isLoading,
    error,
    refresh: fetchLimits,
  };
}
