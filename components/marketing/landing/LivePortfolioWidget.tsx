"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
export function LivePortfolioWidget() {
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  const [openPositions, setOpenPositions] = useState<number | null>(null);
  const [winRate, setWinRate] = useState<number | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);
  const [spark, setSpark] = useState<number[]>([]);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
    const load = async () => {
      try {
        const res = await fetch("/api/performance/live", { cache: "no-store" });
        const json = await res.json();
        setTodayPnl(typeof json.today_pnl === "number" ? json.today_pnl : null);
        setOpenPositions(typeof json.open_positions === "number" ? json.open_positions : null);
        setWinRate(typeof json.win_rate_30d === "number" ? Math.round(json.win_rate_30d * 10) / 10 : null);
        setMarketOpen(Boolean(json.market_open));
        const curveVals: number[] = Array.isArray(json.equity_curve)
          ? json.equity_curve.map((p: { equity: number | null }) => (typeof p.equity === "number" ? p.equity : 0))
          : [];
        const last24 = curveVals.slice(-24);
        setSpark(last24.length ? last24 : curveVals.slice(-24));
      } catch {}
    };
    load();
    const id = setInterval(load, 60_000 * 5);
    return () => clearInterval(id);
  }, []);

  const isPositive = (todayPnl ?? 0) > 0;
  const isNegative = (todayPnl ?? 0) < 0;
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

      {/* Today's P&L */}
          <div className="mb-1 flex items-center gap-2">
            <div className={`relative flex h-3 w-3 ${marketOpen ? "bg-emerald-500" : "bg-gray-500"} rounded-full`} />
            <div className="text-xs text-muted-foreground">{marketOpen ? "Market open" : "Market closed"}</div>
          </div>
          <div className="mb-6">
            <div className="text-sm text-muted-foreground mb-1">Today&apos;s P&amp;L</div>
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
                ${Math.abs(todayPnl ?? 0).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Win Rate (30d)</div>
          <div className="text-2xl font-semibold">{winRate ?? "--"}%</div>
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
          <div className="mt-4 flex justify-end">
            <Badge variant="outline" className="text-xs">
              {marketOpen ? "Live" : "Most recent"}
            </Badge>
          </div>
    </Card>
  );
}
