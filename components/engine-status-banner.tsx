'use client';

import { useEffect, useState } from 'react';
import { useEngineStatus } from '@/lib/hooks/useEngineStatus';
import { Clock, CheckCircle2, TrendingDown } from 'lucide-react';
import { useMemo } from 'react';
import { getTradeGateStatus, type TradeGateStatus } from '@/lib/trade-gate';

/**
 * Calculate time until next cron execution (runs every hour at :30)
 * Synced to actual evaluation schedule
 */
function getTimeUntilNextEvaluation(): number {
  const now = new Date();
  const currentMinute = now.getMinutes();
  const currentSecond = now.getSeconds();

  let minutesUntilNextRun: number;

  if (currentMinute < 30) {
    // Next run is at :30 of current hour
    minutesUntilNextRun = 30 - currentMinute;
  } else {
    // Next run is at :30 of next hour
    minutesUntilNextRun = 60 - currentMinute + 30;
  }

  // Return total seconds until next run
  return minutesUntilNextRun * 60 - currentSecond;
}

/**
 * Engine Status Banner - User-facing component
 *
 * Displays engine evaluation status when no signals are found.
 * Shows:
 * - Primary message: "No validated trading setups this hour"
 * - Secondary reason message
 * - Countdown timer synced to cron schedule (every hour at :30)
 * - Professional status indicators with icons (no emojis)
 *
 * Only visible when: evaluation_completed && signals_found === 0
 */
export function EngineStatusBanner() {
  const { status, loading } = useEngineStatus();
  const [countdown, setCountdown] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [tradeGate, setTradeGate] = useState<TradeGateStatus>(() => getTradeGateStatus());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTradeGate(getTradeGateStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Calculate countdown timer synced to cron schedule
  useEffect(() => {
    if (!mounted || !status?.evaluation_completed || status.signals_found > 0 || !tradeGate.allowed) return;

    const updateCountdown = () => {
      const secondsRemaining = getTimeUntilNextEvaluation();
      const minutes = Math.floor(secondsRemaining / 60);
      const seconds = secondsRemaining % 60;

      if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [mounted, status?.evaluation_completed, status?.signals_found, tradeGate.allowed]);

  const gateInfo = useMemo(() => {
    if (tradeGate.allowed) return null;
    if (tradeGate.reason === 'OPENING_WINDOW_NO_TRADE') {
      return {
        label: 'Opens 10:00 ET',
        detail: 'Signals resume after the opening auction stabilizes.',
      };
    }
    if (tradeGate.reason === 'CLOSE_WINDOW_NO_TRADE') {
      return {
        label: 'Session closed',
        detail: 'New signals pause after 15:55 ET until the next day.',
      };
    }
    return {
      label: 'Market closed',
      detail: 'Signals resume next NYSE session at 10:00 ET.',
    };
  }, [tradeGate]);

  // Don't render until hydrated
  if (!mounted || loading) return null;

  // Only show if evaluation completed and no signals found
  if (!status || !status.evaluation_completed || status.signals_found > 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-blue-200/40 bg-gradient-to-br from-blue-50/60 to-cyan-50/40 dark:border-blue-900/30 dark:from-blue-950/30 dark:to-cyan-950/20 px-4 py-3 mb-6">
      {/* Premium flex layout: icon + content + timer */}
      <div className="flex items-center justify-between gap-4">
        {/* Left section: icon + messages */}
        <div className="flex items-start gap-3 flex-1">
          {/* Premium circular icon container */}
          <div className="rounded-full bg-blue-100/50 dark:bg-blue-900/40 p-2.5 flex-shrink-0 mt-0.5">
            <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>

          {/* Content section */}
          <div className="flex-1 min-w-0">
            {/* Primary heading */}
            <h3 className="font-semibold text-blue-950 dark:text-blue-50 text-sm leading-tight">
              No validated trading setups this hour
            </h3>

            {/* Secondary reason text */}
            <p className="text-blue-900/70 dark:text-blue-100/70 text-xs mt-1">
              {status.evaluation_reason || 'Market conditions did not meet our quality thresholds.'}
            </p>

            {/* Status indicators - icon-based, no emojis */}
            <div className="flex items-center gap-2.5 mt-2.5 text-xs">
              <div className="flex items-center gap-1 text-blue-700 dark:text-blue-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Engine active</span>
              </div>
              <span className="text-blue-400 dark:text-blue-600">•</span>
              <div className="flex items-center gap-1 text-blue-700 dark:text-blue-300">
                <TrendingDown className="w-3.5 h-3.5" />
                <span>Market evaluated</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right section: gate-aware status */}
        {gateInfo ? (
          <div className="flex flex-col items-end justify-center flex-shrink-0 bg-white/40 dark:bg-slate-800/40 rounded-lg px-3 py-2 min-w-[160px] text-right">
            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium uppercase tracking-wider leading-tight">
              {gateInfo.label}
            </p>
            <p className="text-[11px] text-blue-900/70 dark:text-blue-100/70 leading-tight">{gateInfo.detail}</p>
          </div>
        ) : (
          countdown && (
            <div className="flex flex-col items-end justify-center flex-shrink-0 bg-white/40 dark:bg-slate-800/40 rounded-lg px-3 py-2 min-w-fit">
              <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium uppercase tracking-wider leading-tight">Next</p>
              <p className="text-base font-bold text-blue-900 dark:text-blue-100 tabular-nums leading-tight">{countdown}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
