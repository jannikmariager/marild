"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Lock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type EngineMode = "DAYTRADER" | "SWING";
type EngineVersion = "V3" | "V3_5" | "V4" | "V4_1";

type EngineBadgeProps = {
  ticker: string;
  mode: EngineMode;
  timeframe?: string; // e.g. "INTRADAY_5", "4H", "1D"
  engineVersion: EngineVersion;
  isPro: boolean;
  showUpgrade?: boolean;
  className?: string;
};

function getEngineLabel(mode: EngineMode, timeframe: string | undefined, engineVersion: EngineVersion) {
  const tfLabel =
    mode === "DAYTRADER"
      ? "Intraday"
      : timeframe === "4H"
      ? "Swing 4H"
      : timeframe === "1D"
      ? "Swing 1D"
      : timeframe === "1W"
      ? "Swing 1W"
      : timeframe === "1M"
      ? "Swing 1M"
      : timeframe ?? "Swing";

  const engineName = getEngineName(engineVersion);

  return `${tfLabel} · ${engineName}`;
}

function getEngineName(engineVersion: EngineVersion): string {
  switch (engineVersion) {
    case "V3":
      return "Structure";
    case "V3_5":
      return "Momentum";
    case "V4":
      return "SMC";
    case "V4_1":
      return "SMC+";
    default:
      return engineVersion;
  }
}

function getEngineColor(engineVersion: EngineVersion): string {
  switch (engineVersion) {
    case "V3":
      return "bg-emerald-100 text-emerald-800 dark:text-emerald-300 border-emerald-300";
    case "V3_5":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    case "V4":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
    case "V4_1":
      return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
    default:
      return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
  }
}

export function EngineBadge(props: EngineBadgeProps) {
  const { ticker, mode, timeframe, engineVersion, isPro, showUpgrade = true, className } = props;

  if (!engineVersion) return null;

  const label = getEngineLabel(mode, timeframe, engineVersion);
  const colorClass = getEngineColor(engineVersion);

  // PRO gating for SWING signals
  if (mode === "SWING" && !isPro) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge 
          variant="outline" 
          className="opacity-60 backdrop-blur-[2px] border-amber-500/30 bg-amber-500/5"
        >
          <Lock className="w-3 h-3 mr-1.5" />
          <span className="blur-[1px]">Swing · AI Engine</span>
        </Badge>
        {showUpgrade && (
          <span className="text-xs text-muted-foreground">
            <span className="hidden sm:inline">Upgrade to </span>Pro for swing signals
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Badge 
        variant="outline" 
        className={cn(
          "text-xs font-medium border transition-colors",
          colorClass
        )}
      >
        <Zap className="w-3 h-3 mr-1.5" />
        {label}
      </Badge>
      <span className="text-[11px] text-muted-foreground hidden md:inline">
        Auto-routed for {ticker}
      </span>
    </div>
  );
}

export function EngineTooltip({ engineVersion }: { engineVersion: EngineVersion }) {
  const descriptions: Record<EngineVersion, string> = {
    V3: "Structure-focused strategy optimized for clear trend and range patterns",
    V3_5: "Momentum-enhanced strategy for capturing directional moves and breakouts",
    V4: "Smart Money Concepts strategy for institutional order flow patterns",
    V4_1: "Relaxed SMC strategy with higher tolerance for noise and volatility",
  };

  return (
    <div className="text-xs space-y-1">
      <div className="font-medium">{getEngineName(engineVersion)} Engine</div>
      <div className="text-muted-foreground">{descriptions[engineVersion]}</div>
    </div>
  );
}
