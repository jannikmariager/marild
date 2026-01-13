"use client";

import * as React from "react";

interface RiskRewardRailProps {
  signalEntryPrice: number;
  initialSignalSlPrice: number;
  activeSlPrice: number;
  tp1Price: number;
  tp2Price?: number | null;
  currentPrice?: number | null;
  side: "LONG" | "SHORT";
  variant?: "compact" | "full";
}

export function RiskRewardRail({
  signalEntryPrice,
  initialSignalSlPrice,
  activeSlPrice,
  tp1Price,
  tp2Price,
  currentPrice,
  side,
  variant = "compact",
}: RiskRewardRailProps) {
  const isShort = side === "SHORT";

  const prices = React.useMemo(() => {
    const p = [signalEntryPrice, initialSignalSlPrice, activeSlPrice, tp1Price];
    if (tp2Price != null) p.push(tp2Price);
    if (typeof currentPrice === "number" && !Number.isNaN(currentPrice)) {
      p.push(currentPrice);
    }
    return p;
  }, [signalEntryPrice, initialSignalSlPrice, activeSlPrice, tp1Price, tp2Price, currentPrice]);

  if (prices.length === 0) return null;

  const min = Math.min(...prices);
  let max = Math.max(...prices);
  if (Math.abs(max - min) < 1e-6) {
    max = min + 1;
  }

  const normalize = (price: number) => {
    const t = (price - min) / (max - min);
    const base = 1 - t; // top = higher price for long
    return base;
  };

  const entry = signalEntryPrice;
  const sl = activeSlPrice;
  const tp = tp2Price ?? tp1Price;

  let riskActive: boolean;
  let atBreakEven: boolean;
  let profitLocked: boolean;

  if (!isShort) {
    riskActive = sl < entry;
    atBreakEven = Math.abs(sl - entry) < 1e-6;
    profitLocked = sl > entry;
  } else {
    riskActive = sl > entry;
    atBreakEven = Math.abs(sl - entry) < 1e-6;
    profitLocked = sl < entry;
  }

  // Calculate zone percentages for minimum height enforcement
  const profitZoneTop = Math.min(normalize(entry), normalize(tp)) * 100;
  const profitZoneBottom = (1 - Math.max(normalize(entry), normalize(tp))) * 100;
  const profitZoneHeight = 100 - profitZoneTop - profitZoneBottom;

  const riskZoneTop = riskActive ? Math.min(normalize(sl), normalize(entry)) * 100 : 0;
  const riskZoneBottom = riskActive ? (1 - Math.max(normalize(sl), normalize(entry))) * 100 : 0;
  const riskZoneHeight = riskActive ? 100 - riskZoneTop - riskZoneBottom : 0;

  const lockedZoneTop = profitLocked ? Math.min(normalize(entry), normalize(sl)) * 100 : 0;
  const lockedZoneBottom = profitLocked ? (1 - Math.max(normalize(entry), normalize(sl))) * 100 : 0;
  const lockedZoneHeight = profitLocked ? 100 - lockedZoneTop - lockedZoneBottom : 0;

  const trackWidth = variant === "compact" ? "0.75rem" : "1.25rem";
 
   return (
     <div className="relative flex flex-col items-center" aria-hidden>
       <div
         className="relative flex-1 w-full flex items-stretch justify-center"
         style={{ minHeight: variant === "compact" ? 100 : 300 }}
       >
         <div
           className="relative rounded bg-gray-200 overflow-hidden"
           style={{ width: trackWidth, minHeight: "100%" }}
         >
           {/* 1) Profit zone (Entry to TP) - Green */}
           <div
             className="absolute inset-x-0 bg-emerald-400"
             style={{
               top: `${profitZoneTop}%`,
               bottom: `${profitZoneBottom}%`,
             }}
           />
 
           {/* 2) Locked profit zone (Entry to trailing SL) - Dark green overlay */}
           {profitLocked && !atBreakEven && lockedZoneHeight > 0.5 && (
             <div
               className="absolute inset-x-0 bg-emerald-600"
               style={{
                 top: `${lockedZoneTop}%`,
                 bottom: `${lockedZoneBottom}%`,
               }}
             />
           )}
 
           {/* 3) Risk zone (SL to Entry) - Red overlay */}
           {riskActive && !atBreakEven && riskZoneHeight > 0.5 && (
             <div
               className="absolute inset-x-0 bg-red-500"
               style={{
                 top: `${riskZoneTop}%`,
                 bottom: `${riskZoneBottom}%`,
               }}
             />
           )}

          {/* Price level notches - subtle marks on the right edge */}
          <div
            className="absolute right-0 w-1 h-px bg-red-700"
            style={{ top: `${normalize(sl) * 100}%` }}
            title="Stop Loss"
          />
          <div
            className="absolute right-0 w-1 h-px bg-gray-900"
            style={{ top: `${normalize(entry) * 100}%` }}
            title="Entry"
          />
          <div
            className="absolute right-0 w-1 h-px bg-emerald-700"
            style={{ top: `${normalize(tp1Price) * 100}%` }}
            title="TP1"
          />
          {tp2Price != null && (
            <div
              className="absolute right-0 w-1 h-px bg-emerald-600"
              style={{ top: `${normalize(tp2Price) * 100}%` }}
              title="TP2"
            />
          )}

          {/* Current price marker */}
          {typeof currentPrice === "number" && !Number.isNaN(currentPrice) && (
            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ top: `${normalize(currentPrice) * 100}%` }}
            >
              <div className="h-2.5 w-2.5 rounded-full bg-blue-500 border border-white shadow" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}