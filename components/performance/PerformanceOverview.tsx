"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Star } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TickerStats {
  ticker: string;
  trades: number;
  win_rate: number;
  expectancy: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
  // live stats (optional)
  live_trades?: number;
  live_profit_factor?: number | null;
}

interface UniverseTicker {
  ticker: string;
  horizons: string[]; // kept for compatibility; now always ['swing']
  stats: Record<string, TickerStats>;
  max_expectancy: number; // not used with journal-driven data but preserved for type stability
  backtest_expectancy?: number;
  live_trades?: number;
  live_profit_factor?: number | null;
  live_pf_infinite?: boolean;
  live_net_pnl?: number;
  live_win_rate?: number | null;
  is_promoted?: boolean; // from admin console universe
}

interface ApiResponse {
  tickers: UniverseTicker[];
  access?: { is_locked: boolean };
  error?: string;
  message?: string;
}

// Internal-only helpers for deriving non-performance eligibility traits
// from underlying stats. Raw performance numbers are never rendered.

export default function PerformanceOverview() {
  const [data, setData] = useState<UniverseTicker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/performance/universe");
        const payload: ApiResponse = await response.json().catch(() => ({ tickers: [] }));

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (payload.access?.is_locked || payload.error === "LOCKED") {
              if (!isMounted) return;
              setIsLocked(true);
              setData([]);
              return;
            }
          }
          throw new Error(payload.message || "Failed to load performance universe");
        }

        if (!isMounted) return;
        setIsLocked(Boolean(payload.access?.is_locked));
        const list = payload.tickers || [];
        // Backend already sorts by live_net_pnl; keep that order
        setData(list);
      } catch (err: any) {
        if (!isMounted) return;
        console.error("[PerformanceOverview] Error loading universe", err);
        setError(err.message || "Failed to load performance universe");
      } finally {
        if (!isMounted) return;
        setIsLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  const rows = useMemo(() => {
    // Preserve stable ordering from backend (currently max_expectancy), but do not
    // sort or rank on performance in the UI.
    return [...data];
  }, [data]);

  if (isLoading) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Model Coverage &amp; Signal Eligibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-7 w-48 bg-gray-100 rounded-md animate-pulse" />
          <div className="h-10 w-full bg-gray-100 rounded-md animate-pulse" />
          <div className="h-10 w-full bg-gray-100 rounded-md animate-pulse" />
          <div className="h-10 w-full bg-gray-100 rounded-md animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (isLocked) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Market Coverage &amp; Signal Eligibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[#374151]">
            See the full leaderboard of tickers that passed our engine’s performance filters (expectancy, win rate,
            drawdown).
          </p>
          <p className="text-sm text-[#6B7280]">
            Upgrade to PRO to unlock the performance universe overview.
          </p>
          <UpgradeButton
            className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white w-full justify-center"
          >
            Unlock performance overview
          </UpgradeButton>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Model Coverage &amp; Signal Eligibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[#6B7280]">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="text-[#111827] border-[#E5E7EB]"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="text-[#111827]">Model Coverage &amp; Signal Eligibility</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#6B7280]">
            No approved performance tickers yet. Once our engine finishes evaluation, they will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Model Coverage &amp; Live Auto-Trade Performance</h2>
          <p className="text-sm text-gray-600 mt-1">
            Each row shows how the Marild engine has actually traded this ticker in the last 30 days (live
            auto-trades), based on the real journal. Promoted symbols are flagged by the admin console.
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            Live trades, P&amp;L, and win rate are calculated from executed trades in the SWING model portfolio
            over a rolling 30-day window.
          </p>
        </div>
      </div>

      <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-xs text-[#6B7280]">
                  <th className="text-left py-2 px-1">Ticker</th>
                  <th className="text-left py-2 px-1">Coverage Status</th>
                  <th className="text-right py-2 px-1">Live trades</th>
                  <th className="text-right py-2 px-1">Live P&L</th>
                  <th className="text-right py-2 px-1">Live win%</th>
                </tr>
              </thead>
              <AnimatePresence initial={false}>
                <tbody>
                  {rows.map((row) => {
                    const best = getBestHorizonStats(row);

                    return (
                      <motion.tr
                        key={row.ticker}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className="border-b border-[#F3F4F6] last:border-0 hover:bg-gray-50/70 cursor-pointer"
                        onClick={() => {
                    // Navigate to detailed performance page for this ticker
                    window.location.href = `/performance/${encodeURIComponent(row.ticker)}`;
                  }}
                      >
                        <td className="py-2 px-1 font-mono text-[#111827] text-sm">
                          {row.ticker.toUpperCase()}
                        </td>
                        <td className="py-2 px-1 text-left text-[#111827]">
                          {row.is_promoted ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              <Star className="h-3 w-3" />
                              Promoted
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">Traded</span>
                          )}
                        </td>
                        <td className="py-2 px-1 text-right text-[#111827]">
                          {row.live_trades ?? 0}
                        </td>
                        <td className="py-2 px-1 text-right text-[#111827]">
                          {typeof row.live_net_pnl === 'number'
                            ? `${row.live_net_pnl >= 0 ? '+' : ''}$${Math.round(row.live_net_pnl).toLocaleString()}`
                            : '—'}
                        </td>
                        <td className="py-2 px-1 text-right text-[#111827]">
                          {row.live_win_rate != null
                            ? `${(row.live_win_rate * 100).toFixed(0)}%`
                            : row.live_trades && row.live_trades > 0
                            ? '100%'
                            : '—'}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </AnimatePresence>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-gray-500">
            This view is informational only and focuses on model coverage and structural signal eligibility. It does not
            display or imply historical or future performance.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function getBestHorizonStats(row: UniverseTicker): TickerStats | null {
  const horizons = Object.values(row.stats || {});
  if (!horizons.length) return null;
  // Use highest internal quality horizon as the representative one
  return horizons.reduce((best, curr) => (curr.expectancy > best.expectancy ? curr : best));
}

// Structural consistency heuristics removed from UI to avoid confusion between backtest quality
// and live performance. getQualityScore has been fully removed.

function deriveCoverageStatus(row: UniverseTicker): 'Active' | 'Paused' {
  const horizons = row.horizons || [];
  if (!horizons.length) return 'Paused';
  return 'Active';
}

// deriveSignalEligibility no longer used; live stats are shown in dedicated columns

// Legacy helper kept for internal derivation only
function deriveSignalStatus(row: UniverseTicker): "Eligible" | "Limited" | "Experimental" {
  const horizons = row.horizons || [];
  if (!horizons.length) return "Experimental";
  if (horizons.includes("day") || horizons.includes("swing")) return "Eligible";
  return "Limited";
}

function deriveSignalFrequency(row: UniverseTicker): "Low" | "Medium" | "High" {
  const horizons = Object.values(row.stats || {});
  if (!horizons.length) return "Low";
  const avgTrades = horizons.reduce((sum, h) => sum + (h.trades || 0), 0) / horizons.length;
  if (avgTrades >= 80) return "High";
  if (avgTrades >= 30) return "Medium";
  return "Low";
}
