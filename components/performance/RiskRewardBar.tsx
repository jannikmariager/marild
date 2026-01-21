"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Utility to calculate risk state
export function getRiskState(
  stopLoss: number,
  entry: number,
  isProfitLocked: boolean
): "risk" | "breakeven" | "locked" {
  if (Math.abs(stopLoss - entry) < 0.01) {
    return "breakeven";
  } else if (isProfitLocked) {
    return "locked";
  } else {
    return "risk";
  }
}

type RiskRewardBarProps = {
  signalEntryPrice: number;
  activeSlPrice: number;
  tp1Price: number;
  currentPrice: number;
  side: "LONG" | "SHORT";
  tp2Price?: number | null;
};

export function RiskRewardBar({
  signalEntryPrice,
  activeSlPrice,
  tp1Price,
  currentPrice,
  side,
  tp2Price,
}: RiskRewardBarProps) {
  // Use executed entry (signalEntryPrice is the executed entry in our data)
  const entry = signalEntryPrice;
  const stopLoss = activeSlPrice;
  const tp1 = tp1Price;
  const isShort = side === "SHORT";

  // FIXED DOMAIN SCALING: Add padding to ensure all zones are visible
  const padding = Math.abs(tp1 - entry) * 0.15;
  const minPrice = Math.min(stopLoss, entry, tp1) - padding;
  const maxPrice = Math.max(stopLoss, entry, tp1) + padding;
  const range = maxPrice - minPrice;

  // NORMALIZE: For SHORT, invert coordinate system so profit points RIGHT
  const normalize = (price: number) => {
    if (isShort) {
      // Invert: higher price (worse for SHORT) = left side (0%)
      return ((maxPrice - price) / range) * 100;
    } else {
      // Normal: lower price = left side (0%)
      return ((price - minPrice) / range) * 100;
    }
  };

  const entryPct = normalize(entry);
  const slPct = normalize(stopLoss);
  const tpPct = normalize(tp1);
  const currentPctRaw = normalize(currentPrice);
  const currentPct = Math.max(0, Math.min(100, currentPctRaw));

  // PROFIT LOCKED LOGIC (based on raw prices, not percentages)
  const isProfitLocked = isShort ? stopLoss <= entry : stopLoss >= entry;

  // Calculate zone positions and widths in NORMALIZED space
  // After normalization, zones work identically for LONG and SHORT
  // Entry is always the pivot point
  // TP is always to the right (profit direction)
  // SL position determines risk vs locked profit
  
  const profitStart = Math.min(entryPct, tpPct);
  const profitWidth = Math.abs(tpPct - entryPct);

  const riskStart = Math.min(slPct, entryPct);
  const riskWidth = Math.abs(slPct - entryPct);

  const lockedStart = Math.min(entryPct, slPct);
  const lockedWidth = isProfitLocked ? Math.abs(slPct - entryPct) : 0;

  // Debug logging
  if (typeof window !== 'undefined') {
    console.log('RiskRewardBar:', {
      side, isProfitLocked,
      raw: { entry, stopLoss, tp1 },
      normalized: { 
        entry: entryPct.toFixed(1) + '%', 
        sl: slPct.toFixed(1) + '%', 
        tp: tpPct.toFixed(1) + '%' 
      },
      zones: { 
        profit: profitWidth.toFixed(1) + '%', 
        risk: riskWidth.toFixed(1) + '%', 
        locked: lockedWidth.toFixed(1) + '%' 
      }
    });
  }

  // Determine risk state for badge (exported as utility)
  // NOTE: currently not rendered in this component, but kept for consumers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const riskState = getRiskState(stopLoss, entry, isProfitLocked);

  return (
    <div className="space-y-1.5">
      {/* Risk-Reward Bar with tooltip */}
      <div>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div className="relative w-full rounded-md bg-gray-400 cursor-help" style={{ height: '10px', overflow: 'visible' }}>
        {/* Profit potential zone (Entry → TP) — ALWAYS VISIBLE */}
        {profitWidth > 0.5 && (
          <div
            className="absolute top-0 h-full transition-all duration-200 ease-out z-[1]"
            style={{
              left: `${profitStart}%`,
              width: `${profitWidth}%`,
              backgroundColor: '#34d399',
              opacity: 0.8,
            }}
          />
        )}

        {/* Risk zone (SL → Entry) — RED when risk active */}
        {!isProfitLocked && riskWidth > 0.5 && (
          <div
            className="absolute top-0 h-full transition-all duration-200 ease-out z-[2]"
            style={{
              left: `${riskStart}%`,
              width: `${riskWidth}%`,
              backgroundColor: '#f87171',
              opacity: 0.85,
            }}
          />
        )}

        {/* Locked profit zone (Entry → SL) — DARK GREEN when profit locked */}
        {isProfitLocked && lockedWidth > 0.5 && (
          <div
            className="absolute top-0 h-full transition-all duration-200 ease-out z-[2]"
            style={{
              left: `${lockedStart}%`,
              width: `${lockedWidth}%`,
              backgroundColor: '#059669',
              opacity: 1,
            }}
          />
        )}

        {/* Entry anchor (STATIC, NEVER MOVES) — primary reference point */}
        <div
          className="absolute top-0 h-full w-[2px] bg-white shadow-sm z-[3]"
          style={{ left: `${entryPct}%` }}
        />

        {/* Current price marker (triangle pointing down with value above) */}
        <div
          className="absolute z-[4] transition-all duration-200 ease-out"
          style={{ left: `${currentPct}%`, top: '-24px', transform: 'translateX(-50%)' }}
        >
          <div className="flex flex-col items-center gap-0.5">
            <div className="font-mono text-[10px] text-blue-600 font-bold whitespace-nowrap bg-white px-1 rounded">${currentPrice.toFixed(2)}</div>
            <svg width="12" height="8" viewBox="0 0 12 8" className="drop-shadow-md">
              <polygon points="6,8 0,0 12,0" fill="#2563eb" />
            </svg>
          </div>
        </div>
      </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="space-y-0.5">
            <div><span className="font-semibold">Stop Loss:</span> ${stopLoss.toFixed(2)}</div>
            <div><span className="font-semibold">Entry:</span> ${entry.toFixed(2)}</div>
            <div><span className="font-semibold">TP1:</span> ${tp1.toFixed(2)}</div>
            {tp2Price && <div><span className="font-semibold">TP2:</span> ${tp2Price.toFixed(2)}</div>}
            <div className="pt-0.5 border-t border-gray-600"><span className="font-semibold">Current:</span> ${currentPrice.toFixed(2)}</div>
          </div>
        </TooltipContent>
      </Tooltip>
      </div>

      {/* Static anchor labels with values */}
      <div className="relative w-full h-10 px-4 flex items-start text-[12px] text-slate-500">
        <div className="absolute" style={{ left: `calc(4% + ${slPct}% * 0.92)`, transform: 'translateX(-50%)' }}>
          <div className="text-center">
            <div className="font-mono text-slate-700 font-semibold text-[12px]">${stopLoss.toFixed(2)}</div>
            <div className="mt-0.5">SL</div>
          </div>
        </div>
        <div className="absolute" style={{ left: `calc(4% + ${entryPct}% * 0.92)`, transform: 'translateX(-50%)' }}>
          <div className="text-center">
            <div className="font-mono text-slate-700 font-semibold text-[12px]">${entry.toFixed(2)}</div>
            <div className="mt-0.5">Entry</div>
          </div>
        </div>
        <div className="absolute" style={{ left: `calc(4% + ${tpPct}% * 0.92)`, transform: 'translateX(-50%)' }}>
          <div className="text-center">
            <div className="font-mono text-slate-700 font-semibold text-[12px]">${tp1.toFixed(2)}</div>
            <div className="mt-0.5">TP</div>
          </div>
        </div>
      </div>
    </div>
  );
}
