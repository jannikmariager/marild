"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

const TRADING_TZ = "America/New_York";

function getNyDateKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TRADING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
}

export function LivePortfolioWidget() {
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  const [openPositions, setOpenPositions] = useState<number | null>(null);
  const [winRate, setWinRate] = useState<number | null>(null);
  const [totalReturnPct, setTotalReturnPct] = useState<number | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);
  const [spark, setSpark] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const REFRESH_INTERVAL_MS = 60_000 * 5;

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
    const load = async () => {
      try {
        // Public preview summary powering cumulative return since launch
        const res = await fetch("/api/performance/summary?public=1", { cache: "no-store" });
        const json = await res.json();

        // Establish trading-day context in New York time
        const now = new Date();
        const utcHour = now.getUTCHours();
        const day = now.getUTCDay(); // 0 = Sun
        const isWeekday = day >= 1 && day <= 5;
        const isUsSession = utcHour >= 14 && utcHour <= 21; // ~9:00–16:59 ET
        const todayNyKey = getNyDateKey(now);

        // Today P&L (realized only): reuse journal API so it matches the Trading Journal view
        try {
          const journalRes = await fetch("/api/performance/journal?strategy=SWING&days=2", { cache: "no-store" });
          if (journalRes.ok) {
            const journal = await journalRes.json().catch(() => ({} as any));
            const days: { date: string; total_pnl: number }[] = Array.isArray(journal.days)
              ? journal.days
              : [];
            if (days.length > 0) {
              const lastDay = days[days.length - 1];
              const pnl = typeof lastDay.total_pnl === "number" ? lastDay.total_pnl : 0;

              // If we are on a new trading day (NY) but before the regular
              // session opens, neutralize yesterday's P&L so "Today" starts flat.
              const lastDayKey = typeof lastDay.date === "string" ? lastDay.date : "";
              const isSameNyTradingDay = lastDayKey === todayNyKey;
              const shouldNeutralize = isWeekday && !isUsSession && !isSameNyTradingDay;

              setTodayPnl(shouldNeutralize ? 0 : pnl);
            } else {
              setTodayPnl(0);
            }
          } else {
            setTodayPnl(0);
          }
        } catch {
          setTodayPnl(0);
        }

        // Open positions: read from lightweight live API (live_positions)
        try {
          const liveRes = await fetch("/api/performance/live", { cache: "no-store" });
          if (liveRes.ok) {
            const liveJson = await liveRes.json().catch(() => ({} as any));
            if (typeof liveJson.open_positions === "number") {
              setOpenPositions(liveJson.open_positions);
            } else {
              setOpenPositions(null);
            }
          } else {
            setOpenPositions(null);
          }
        } catch {
          setOpenPositions(null);
        }

        // Win rate from summary
        const rawWinRate = typeof json.win_rate_pct === "number" ? json.win_rate_pct : null;
        if (rawWinRate != null) {
          setWinRate(Math.round(rawWinRate * 10) / 10);
        } else {
          setWinRate(null);
        }

        // Cumulative net return since launch (percentage change vs starting equity)
        const rawReturn = typeof json.total_return_pct === "number" ? json.total_return_pct : null;
        if (rawReturn != null) {
          setTotalReturnPct(Math.round(rawReturn * 100) / 100);
        } else {
          setTotalReturnPct(null);
        }

        // Market open heuristic based on US hours (approximate)
        setMarketOpen(isWeekday && isUsSession);

        // Sparkline uses equity_curve for overall journey
        const curve: { date: string; equity: number }[] = Array.isArray(json.equity_curve)
          ? json.equity_curve
          : [];
        const curveVals: number[] = curve.map((p) => (typeof p.equity === "number" ? p.equity : 0));
        const last24 = curveVals.slice(-24);
        setSpark(last24.length ? last24 : curveVals.slice(-24));
        setLastUpdated(new Date());
      } catch (e) {
        console.error("Failed loading landing LivePortfolioWidget", e);
      }
    };
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const isPositive = (totalReturnPct ?? 0) > 0;
  const isNegative = (totalReturnPct ?? 0) < 0;
  const isFlat = !isPositive && !isNegative;

  if (!mounted) {
    return (
      <Card className="relative overflow-hidden border-border/50 bg-card backdrop-blur-sm p-6 shadow-2xl">
        <div className="h-[400px] flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden border-border/50 bg-card backdrop-blur-sm p-6 shadow-2xl">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-purple-500/5 pointer-events-none" />
      
      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
        </div>
        <span className="text-xs font-medium text-muted-foreground">LIVE PORTFOLIO</span>
      </div>

      {/* Since launch performance */}
          <div className="mb-1 flex items-center gap-2">
            <div className={`relative flex h-3 w-3 ${marketOpen ? "bg-emerald-500" : "bg-gray-500"} rounded-full`} />
            <div className="text-xs text-muted-foreground">{marketOpen ? "Market open" : "Market closed"}</div>
          </div>
          <div className="mb-6">
            <div className="text-sm text-muted-foreground mb-1">Since Launch (Net Return)</div>
            <div
              className={`text-4xl font-bold flex items-center gap-2 transition-colors duration-300 ${
                isPositive ? "text-emerald-500" : isNegative ? "text-red-500" : "text-muted-foreground"
              }`}
              suppressHydrationWarning
            >
              {isPositive ? (
                <TrendingUp className="w-8 h-8" />
              ) : isNegative ? (
                <TrendingDown className="w-8 h-8" />
              ) : (
                <Activity className="w-8 h-8 text-muted-foreground" />
              )}
              <span suppressHydrationWarning>
                {totalReturnPct == null
                  ? "--%"
                  : `${totalReturnPct >= 0 ? "+" : ""}${Math.abs(totalReturnPct).toFixed(2)}%`}
              </span>
            </div>
          </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Win Rate (30d)</div>
          <div className="text-2xl font-semibold">{winRate != null ? `${winRate}%` : "--%"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
          <div className="text-2xl font-semibold flex items-center gap-1">
            {openPositions ?? "--"}
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Sparkline chart */}
      <div className="h-16 relative">
        <svg className="w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Area under line */}
          <path
            d={`M 0 40 ${spark
              .map((v, i, arr) => {
                const x = (i / Math.max(1, arr.length - 1)) * 100;
                const min = Math.min(...arr);
                const max = Math.max(...arr);
                const range = Math.max(1, max - min);
                const y = 40 - ((v - min) / range) * 40;
                return `L ${x} ${y}`;
              })
              .join(" ")} L 100 40 Z`}
            fill="url(#sparklineGradient)"
            className="animate-pulse"
          />
          
          {/* Line */}
          <path
            d={spark
              .map((v, i, arr) => {
                const x = (i / Math.max(1, arr.length - 1)) * 100;
                const min = Math.min(...arr);
                const max = Math.max(...arr);
                const range = Math.max(1, max - min);
                const y = 40 - ((v - min) / range) * 40;
                return `${i === 0 ? "M" : "L"} ${x} ${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgb(16, 185, 129)"
            strokeWidth="2"
            className="drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]"
          />
        </svg>
      </div>

      {/* Bottom badge */}
      <div className="mt-4 flex flex-col items-end gap-1 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-xs">
          {lastUpdated
            ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/New_York",
              })} ET`
            : "Awaiting live data"}
        </Badge>
        <span className="text-[11px] text-muted-foreground/80">
          Auto-refreshes every {REFRESH_INTERVAL_MS / 60000} min
        </span>
      </div>
    </Card>
  );
}
