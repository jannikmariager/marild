"use client";

import { useQuery } from "@tanstack/react-query";
import type { BacktestResultsPayload } from "@/lib/backtest/types_results";

export function useBacktestResults(symbol: string) {
  const cleanSymbol = (symbol || "").trim().toUpperCase();

  const query = useQuery<BacktestResultsPayload | null>({
    queryKey: ["backtest-results", cleanSymbol],
    queryFn: async () => {
      if (!cleanSymbol) return null;
      const res = await fetch(`/api/backtest/results/${encodeURIComponent(cleanSymbol)}`);
      if (!res.ok) return null;
      try {
        return (await res.json()) as BacktestResultsPayload;
      } catch {
        return null;
      }
    },
    enabled: !!cleanSymbol,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: !!query.error,
  };
}
