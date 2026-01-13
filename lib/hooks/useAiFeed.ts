import useSWR from 'swr';
import { createClient } from '@/lib/supabaseBrowser';
import type {
  AiMarketSummary,
  QuickActionsResponse,
  TrendingSignalsResponse,
  SectorStrengthResponse,
} from '@/types/aiFeed';

const supabase = createClient();

// Fetcher for Supabase Edge Functions
async function fetchEdgeFunction<T>(functionName: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    method: 'GET',
  });

  if (error) throw error;
  return data as T;
}

// Hook: Market Summary
export function useMarketSummary() {
  const { data, error, isLoading, mutate } = useSWR<AiMarketSummary>(
    'ai_market_summary',
    () => fetchEdgeFunction<AiMarketSummary>('ai_market_summary'),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
    }
  );

  return {
    summary: data,
    isLocked: data?.access?.is_locked ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
}

// Hook: Quick Actions
export function useQuickActions() {
  const { data, error, isLoading, mutate } = useSWR<QuickActionsResponse>(
    'ai_quick_actions',
    () => fetchEdgeFunction<QuickActionsResponse>('ai_quick_actions'),
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 minutes (static data)
    }
  );

  return {
    actions: data?.actions ?? [],
    isLocked: data?.access?.is_locked ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
}

// Hook: Trending Signals
export function useTrendingSignals() {
  const { data, error, isLoading, mutate } = useSWR<TrendingSignalsResponse>(
    'trending_ai_signals',
    () => fetchEdgeFunction<TrendingSignalsResponse>('trending_ai_signals'),
    {
      revalidateOnFocus: false,
      dedupingInterval: 900000, // 15 minutes
    }
  );

  return {
    signals: data?.signals ?? [],
    isLocked: data?.access?.is_locked ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
}

// Hook: Sector Strength
export function useSectorStrength() {
  const { data, error, isLoading, mutate } = useSWR<SectorStrengthResponse>(
    'sector_strength_overview',
    () => fetchEdgeFunction<SectorStrengthResponse>('sector_strength_overview'),
    {
      revalidateOnFocus: false,
      dedupingInterval: 1800000, // 30 minutes
    }
  );

  return {
    sectors: data?.sectors ?? [],
    isLocked: data?.access?.is_locked ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
}
