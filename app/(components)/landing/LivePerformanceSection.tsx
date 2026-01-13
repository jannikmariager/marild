"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDashboardTransition } from "@/components/DashboardTransitionProvider";
import { EquityCurveChart } from "./EquityCurveChart";
import { useEffect, useState } from "react";
import { useAccess } from "@/lib/useAccess";

interface PerfSummary {
  starting_equity?: number | null;
  current_equity?: number | null;
  total_return_pct?: number | null;
  max_drawdown_pct?: number | null;
  trades_count?: number | null;
  win_rate_pct?: number | null;
  swing?: { equity: number; trades: number; wins: number; return_pct: number } | null;
  daytrade?: { equity: number; trades: number; wins: number; return_pct: number } | null;
}

function fmtUSD(n?: number | null) {
  if (typeof n !== "number" || !isFinite(n)) return "--";
  // Rounded whole dollars for landing-page proof metric
  return n.toLocaleString("en-US", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function fmtPct(n?: number | null) {
  if (typeof n !== "number" || !isFinite(n)) return "--";
  // Rounded to one decimal place for simple, high-level view
  return (Math.round(n * 10) / 10).toString();
}

function fmtInt(n?: number | null) {
  if (typeof n !== "number" || !isFinite(n)) return "--";
  return Math.round(n).toString();
}

export function LivePerformanceSection() {
  const [summary, setSummary] = useState<PerfSummary | null>(null);
  const router = useRouter();
  const { startDashboardTransition } = useDashboardTransition();
  const access = useAccess();
  const [ctaHref, setCtaHref] = useState<string>("/signup");

  useEffect(() => {
    if (!access) {
      setCtaHref("/signup");
      return;
    }
    if (!access.is_logged_in) {
      setCtaHref("/signup");
      return;
    }
    if (!access.is_pro && !access.is_trial) {
      setCtaHref("/pricing");
      return;
    }
    setCtaHref("/dashboard");
  }, [access]);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await fetch("/api/performance/summary?public=1", { cache: "no-store" });
        const json = await res.json();
        setSummary(json);
      } catch (e) {
        console.error("Failed loading performance summary", e);
      }
    };
    fetchSummary();
    const id = setInterval(fetchSummary, 60_000 * 5); // refresh every 5m
    return () => clearInterval(id);
  }, []);

  const handleViewDashboard = (e: React.MouseEvent) => {
    if (ctaHref === "/dashboard") {
      e.preventDefault();
      startDashboardTransition();
      router.push(ctaHref);
    }
  };
  
  return (
    <section className="py-24 relative">
      {/* PerformanceSectionContainer: shared horizontal bounds for curve, cards, CTA */}
      <div className="mx-auto max-w-6xl px-4">
        <div className="text-center mb-16">
          <Badge variant="outline" className="mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-2" />
            Model Portfolio • Read-only
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">
            Real Signal Performance
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Transparent model portfolio tracking real signals. Read-only.
          </p>
        </div>

        {/* 1) Equity curve as primary visual (within shared container) */}
        <div className="mb-10">
          <EquityCurveChart />
        </div>

        {/* 2) Summary cards (supporting proof) */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          {/* Card 1 — Active Signals Portfolio */}
          <Card className="p-6 border-border/50 bg-card backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-muted-foreground">Active Signals Portfolio</h3>
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Portfolio Equity</span>
                <span className="text-3xl font-bold">
                  ${fmtUSD(summary?.current_equity ?? summary?.swing?.equity)}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Total Return (Since Start)</span>
                <span className="text-lg font-semibold text-emerald-500">
                  {(() => {
                    const start = summary?.starting_equity ?? null;
                    const current = summary?.current_equity ?? null;
                    if (typeof start !== 'number' || typeof current !== 'number' || !isFinite(start) || !isFinite(current)) {
                      return '--';
                    }
                    const diff = current - start;
                    const pct = start > 0 ? (diff / start) * 100 : 0;
                    const sign = diff >= 0 ? '+' : '-';
                    const absDiff = Math.abs(diff);
                    const absPct = Math.abs(pct);
                    return `${sign}$${fmtUSD(absDiff)} (${sign}${fmtPct(absPct)}%)`;
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Signals Tracked</span>
                <span className="text-lg font-semibold">{fmtInt(summary?.trades_count ?? summary?.swing?.trades)}</span>
              </div>
            </div>
          </Card>

          {/* Card 2 — Model Context (static) */}
          <Card className="p-6 border-border/50 bg-card/80">
            <h3 className="text-lg font-semibold text-muted-foreground mb-4">Model Portfolio</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>$100,000 starting capital</p>
              <p>Signals executed automatically</p>
              <p>Read-only, fully transparent</p>
            </div>
          </Card>
        </div>

        {/* 3) CTA — funnel into in-app performance */}
        <div className="text-center mt-4">
          <Link href={ctaHref} onClick={handleViewDashboard}>
            <Button size="lg" className="gap-2 px-8">
              Explore Live Performance
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
