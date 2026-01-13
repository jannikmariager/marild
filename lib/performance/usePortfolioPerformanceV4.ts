'use client';

import { useEffect, useState } from 'react';
import type { BacktestEngineType } from '@/lib/backtest/types_v4';
import type { EquityPoint } from '@/lib/performance/equity_utils';

export interface PortfolioTickerStats {
  ticker: string;
  equity: EquityPoint[];
  trades: number;
  win_rate: number;
  expectancy: number;
  sqn: number;
}

export interface PortfolioMetrics {
  final_return: number;
  profit_factor: number;
  expectancy: number;
  sqn: number;
  volatility: number;
}

export interface PortfolioPerformanceV4 {
  portfolioEquity: EquityPoint[];
  benchmarkEquity: EquityPoint[];
  perTicker: PortfolioTickerStats[];
  metrics: PortfolioMetrics;
}

interface UsePortfolioPerformanceV4Options {
  tickers: string[];
  engineType: BacktestEngineType;
  enabled?: boolean;
}

export function usePortfolioPerformanceV4({
  tickers,
  engineType,
  enabled = true,
}: UsePortfolioPerformanceV4Options) {
  const [data, setData] = useState<PortfolioPerformanceV4 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || tickers.length === 0) return;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/performance/v4/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers, engineType }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          if (!cancelled) {
            setError(errJson?.error ?? `HTTP_${res.status}`);
            setData(null);
          }
          return;
        }

        const json = await res.json();
        if (!cancelled) {
          const payload = json as any;
          const result: PortfolioPerformanceV4 = {
            portfolioEquity: payload.portfolio_equity ?? [],
            benchmarkEquity: payload.benchmark_equity ?? [],
            perTicker: payload.tickers ?? [],
            metrics: payload.metrics ?? {
              final_return: 0,
              profit_factor: 0,
              expectancy: 0,
              sqn: 0,
              volatility: 0,
            },
          };
          setData(result);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? 'NETWORK_ERROR');
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(tickers), engineType, enabled]);

  return { data, loading, error };
}
