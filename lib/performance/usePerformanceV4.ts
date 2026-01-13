'use client';

import { useEffect, useState } from 'react';
import type { BacktestEngineType } from '@/lib/backtest/types_v4';
import { getHorizonForEngine } from '@/lib/backtest/horizon';

export interface PerformanceV4Point {
  t: number;
  v: number;
}

export interface PerformanceV4Item {
  ticker: string;
  timeframe_used: string;
  bars_loaded: number;
  trades: number;
  win_rate: number;
  avg_return: number;
  max_drawdown: number;
  equity_curve: PerformanceV4Point[];
  anomalies: string[];
  fallback_used: boolean;
}

export interface PerformanceV4Summary {
  // Per-ticker raw results
  items: PerformanceV4Item[];

  // Aggregated view used by the Performance Tab (currently first ticker)
  ticker: string | null;
  timeframe_used: string | null;
  horizon_days: number;
  bars_loaded: number;
  trades: number;
  win_rate: number;
  avg_return: number;
  max_drawdown: number;
  equity_curve: PerformanceV4Point[];
  anomalies: string[];
  fallback_used: boolean;
}

interface UsePerformanceV4Options {
  tickers: string[];
  engineType: BacktestEngineType;
  enabled?: boolean;
}

export function usePerformanceV4({
  tickers,
  engineType,
  enabled = true,
}: UsePerformanceV4Options) {
  const [data, setData] = useState<PerformanceV4Summary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || tickers.length === 0) return;

    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/performance/v4', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tickers,
            engineType,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          if (!cancelled) {
            setError(errJson?.error ?? `HTTP_${res.status}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as PerformanceV4Item[];
        const horizonDays = getHorizonForEngine(engineType);

        if (!cancelled) {
          const first = json[0];

          const summary: PerformanceV4Summary = {
            items: json,
            ticker: first?.ticker ?? null,
            timeframe_used: first?.timeframe_used ?? null,
            horizon_days: horizonDays,
            bars_loaded: first?.bars_loaded ?? 0,
            trades: first?.trades ?? 0,
            win_rate: first?.win_rate ?? 0,
            avg_return: first?.avg_return ?? 0,
            max_drawdown: first?.max_drawdown ?? 0,
            equity_curve: first?.equity_curve ?? [],
            anomalies: first?.anomalies ?? [],
            fallback_used: first?.fallback_used ?? false,
          };

          setData(summary);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? 'NETWORK_ERROR');
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(tickers), engineType, enabled]);

  return { data, isLoading, error };
}
