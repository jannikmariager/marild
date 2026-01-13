"use client";

import { useEffect, useState } from "react";
import type { BacktestEngineType, BacktestV4Response } from "./types_v4";

interface UseBacktestV4Options {
  engineType: BacktestEngineType;
  horizonDays: number;
  tickers: string[];
  enabled?: boolean;
}

export function useBacktestV4({
  engineType,
  horizonDays,
  tickers,
  enabled = true,
}: UseBacktestV4Options) {
  const [data, setData] = useState<BacktestV4Response | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || tickers.length === 0) return;

    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/backtest/v4", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            engine_type: engineType,
            horizon_days: horizonDays,
            tickers,
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

        const json = (await res.json()) as BacktestV4Response;
        if (!cancelled) {
          setData(json);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "NETWORK_ERROR");
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
  }, [engineType, horizonDays, JSON.stringify(tickers), enabled]);

  return { data, isLoading, error };
}
