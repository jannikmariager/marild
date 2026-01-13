'use client'

import { useState, useEffect } from 'react'
import { Clock, CheckCircle2, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EngineStatusBannerProps {
  evaluation_completed?: boolean
  signals_found?: number
  evaluation_reason?: string
  next_evaluation_at?: string
  className?: string
}

/**
 * Calculate time until next cron execution (runs every hour at :30)
 * Synced to actual evaluation schedule - no drift from prop changes
 */
function getTimeUntilNextEvaluation(): number {
  const now = new Date()
  const currentMinute = now.getMinutes()
  const currentSecond = now.getSeconds()

  let minutesUntilNextRun: number

  if (currentMinute < 30) {
    // Next run is at :30 of current hour
    minutesUntilNextRun = 30 - currentMinute
  } else {
    // Next run is at :30 of next hour
    minutesUntilNextRun = 60 - currentMinute + 30
  }

  // Return total seconds until next run
  return minutesUntilNextRun * 60 - currentSecond
}

export function EngineStatusBanner({
  evaluation_completed,
  signals_found,
  evaluation_reason,
  next_evaluation_at,
  className
}: EngineStatusBannerProps) {
  const [countdown, setCountdown] = useState<string>('')
  const [mounted, setMounted] = useState(false)

  // Only show if engine completed evaluation AND no signals found
  const shouldShow = evaluation_completed && (signals_found ?? 0) === 0

  // Initialize on mount
  useEffect(() => {
    setMounted(true)
  }, [])

  // Calculate countdown timer synced to cron schedule
  useEffect(() => {
    if (!mounted || !shouldShow) return

    const updateTimer = () => {
      const secondsRemaining = getTimeUntilNextEvaluation()
      const minutes = Math.floor(secondsRemaining / 60)
      const seconds = secondsRemaining % 60

      if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`)
      } else {
        setCountdown(`${seconds}s`)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [mounted, shouldShow])

  if (!mounted || !shouldShow) return null

  return (
    <div
      className={cn(
        'rounded-lg border border-blue-200/40 bg-gradient-to-br from-blue-50/60 to-cyan-50/40 dark:border-blue-900/30 dark:from-blue-950/30 dark:to-cyan-950/20',
        'px-4 py-3 mb-4',
        className
      )}
    >
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
              {evaluation_reason || 'Market conditions did not meet our quality thresholds during this evaluation.'}
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

        {/* Right section: countdown timer (premium styling) */}
        {countdown && (
          <div className="flex flex-col items-end justify-center flex-shrink-0 bg-white/40 dark:bg-slate-800/40 rounded-lg px-3 py-2 min-w-fit">
            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 font-medium uppercase tracking-wider leading-tight">Next</p>
            <p className="text-base font-bold text-blue-900 dark:text-blue-100 tabular-nums leading-tight">
              {countdown}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
