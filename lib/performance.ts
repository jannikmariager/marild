/**
 * PERFORMANCE V3 DEPRECATED — replaced by V4 Massive+Yahoo Engine for the main
 * Performance Tab UI. This client remains for legacy views and will be removed
 * after full rollout. Do not extend.
 *
 * Performance API Client
 *
 * Handles fetching performance data from Supabase Edge Functions
 */

import { createClient } from '@/lib/supabaseBrowser';

export interface PerformanceSnapshot {
  id: string;
  as_of_date: string;
  time_frame: string;
  strategy_return: number;
  benchmark_symbol: string;
  benchmark_return: number;
  win_rate: number;
  avg_trade_return: number;
  best_trade_return: number;
  worst_trade_return: number;
  max_drawdown: number;
  sample_size: number;
  tp_hit_rate: number;
  updated_at: string;
}

export interface EquityPoint {
  t: string;
  strategy_equity: number;
  benchmark_equity: number;
}

export interface PerformanceAccess {
  is_locked: boolean;
  is_pro: boolean;
}

export interface PerformanceOverview {
  access: PerformanceAccess;
  snapshot: PerformanceSnapshot | null;
  equity_curve: EquityPoint[];
  disclaimer: string;
  message?: string;
}

export interface PerformanceTrade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  return_pct: number;
  holding_period_bars: number;
  tp_hit: boolean;
  confidence_score: number | null;
  sector: string | null;
  timeframe: string;
}

export interface PerformanceTradesResponse {
  trades: PerformanceTrade[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// Centralized performance config
export type ActiveEngineKey = 'swing';

export function getActiveEngine(): ActiveEngineKey {
  const raw = (process.env.NEXT_PUBLIC_MARILD_ACTIVE_ENGINE || '').toLowerCase();
  if (raw === 'swing') return 'swing';
  return 'swing';
}

export function isDaytraderDisabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_MARILD_DISABLE_DAYTRADER;
  return raw === 'true' || raw === '1';
}

export async function fetchPerformanceOverview(
  timeFrame: string
): Promise<PerformanceOverview> {
  const supabase = createClient();
  
  const { data, error } = await supabase.functions.invoke('performance_overview', {
    body: { timeFrame },
  });
  
  if (error) {
    console.error('Error fetching performance overview:', error);
    throw error;
  }
  
  return data as PerformanceOverview;
}

export async function fetchPerformanceTrades(
  timeFrame: string,
  page = 1,
  pageSize = 50
): Promise<PerformanceTradesResponse> {
  const supabase = createClient();
  
  const { data, error } = await supabase.functions.invoke('performance_trades', {
    body: { timeFrame, page, pageSize },
  });
  
  if (error) {
    console.error('Error fetching performance trades:', error);
    throw error;
  }
  
  return data as PerformanceTradesResponse;
}
