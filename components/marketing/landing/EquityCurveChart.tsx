"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatK(value: number) {
  if (!isFinite(value)) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}

export function EquityCurveChart() {
  const [curve, setCurve] = useState<{ date: string; equity: number }[] | null>(null);

  useEffect(() => {
    const fetchCurve = async () => {
      try {
        const res = await fetch("/api/performance/summary", { cache: "no-store" });
        const json = await res.json();
        setCurve(json?.equity_curve ?? []);
      } catch (e) {
        console.error("Failed loading equity curve", e);
      }
    };
    fetchCurve();
    const id = setInterval(fetchCurve, 60_000 * 5);
    return () => clearInterval(id);
  }, []);

  if (!curve) {
    return (
      <Card className="p-6 border-border/50 bg-card backdrop-blur-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-64 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
        </div>
      </Card>
    );
  }

  const data = curve.filter(d => d.equity && d.equity > 0); // Filter out invalid data
  const values = data.map((d) => d.equity);
  
  // Set Y-axis to start at 100k (starting equity) for better visualization
  const startingEquity = 100000;
  const maxEquity = values.length ? Math.max(...values) : startingEquity;
  const minEquity = Math.min(startingEquity, values.length ? Math.min(...values) : startingEquity);

  // Add padding to top so line isn't pinned to edge
  const rawRange = Math.max(1000, maxEquity - minEquity);
  const topPad = rawRange * 0.1;
  const minValue = minEquity;
  const maxValue = maxEquity + topPad;
  const range = Math.max(1, maxValue - minValue);

  const getY = (value: number) => 100 - ((value - minValue) / range) * 100;
  
  // Format date labels (minimal; landing is proof-of-existence only)
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  
  const uniqueDates = data.length > 0 ? Array.from(new Set(data.map(d => d.date))).sort() : [];
  const firstDate = uniqueDates[0] || '';
  const lastDate = uniqueDates[uniqueDates.length - 1] || '';
  
  return (
    <Card className="p-6 pl-16 border-border/50 bg-card backdrop-blur-sm w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold mb-1">Equity Curve (Model Portfolio)</h3>
          <p className="text-sm text-muted-foreground">Symbolic view of portfolio equity over time.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="gap-2">
            <div className="w-3 h-0.5 bg-emerald-500" />
            Portfolio Equity
          </Badge>
        </div>
      </div>
      
      <div className="relative h-64 mb-4">
        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="equityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.1"
              strokeWidth="0.5"
            />
          ))}
          
          
          {/* Area under equity curve */}
          <path
            d={`M 0 100 ${data
              .map((d, i) => {
                const x = (i / Math.max(1, data.length - 1)) * 100;
                const y = getY(d.equity);
                return `L ${x} ${y}`;
              })
              .join(" ")} L 100 100 Z`}
            fill="url(#equityGradient)"
            className="animate-fade-in"
          />
          
          {/* Equity curve line */}
          <path
            d={data
              .map((d, i) => {
                const x = (i / Math.max(1, data.length - 1)) * 100;
                const y = getY(d.equity);
                return `${i === 0 ? "M" : "L"} ${x} ${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="rgb(16, 185, 129)"
            strokeWidth="2"
            className="drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            style={{
              strokeDasharray: 400,
              strokeDashoffset: 400,
              animation: "drawLine 2s ease-out forwards",
            }}
          />
        </svg>
        
        {/* Y-axis labels */}
        <div className="absolute -left-12 top-0 bottom-0 flex flex-col justify-between text-xs text-muted-foreground text-right">
          <span>${formatK(maxValue)}</span>
          <span>${formatK(minValue + (range * 0.5))}</span>
          <span>${formatK(minValue)}</span>
        </div>
      </div>
      
      {/* X-axis date labels (minimal: first and last only) */}
      <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground px-1">
        {firstDate && <span>{formatDate(firstDate)}</span>}
        {lastDate && firstDate !== lastDate && <span>{formatDate(lastDate)}</span>}
      </div>
      
      <style jsx>{`
        @keyframes drawLine {
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>

      {/* helpers */}
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />
    </Card>
  );
}
