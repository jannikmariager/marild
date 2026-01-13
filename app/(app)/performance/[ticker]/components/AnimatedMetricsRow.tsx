'use client';

import { motion, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEffect, useState } from 'react';

interface TickerStats {
  ticker: string;
  trades: number;
  win_rate: number;
  expectancy: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
}

interface AnimatedMetricsRowProps {
  stats: TickerStats;
  previousStats: TickerStats | null;
}

interface MetricCardProps {
  label: string;
  value: number;
  previousValue?: number;
  format: (val: number) => string;
  tooltip: string;
  improved?: boolean;
}

function AnimatedMetricCard({
  label,
  value,
  previousValue,
  format,
  tooltip,
  improved,
}: MetricCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const [flash, setFlash] = useState(false);

  // Animated value using spring physics
  const spring = useSpring(previousValue ?? value, {
    stiffness: 100,
    damping: 30,
  });

  const displayValue = useTransform(spring, (latest) => format(latest));

  useEffect(() => {
    if (previousValue !== undefined && previousValue !== value) {
      spring.set(value);
      // Trigger flash effect
      if (!shouldReduceMotion) {
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
      }
    }
  }, [value, previousValue, spring, shouldReduceMotion]);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
            transition={{ duration: 0.15 }}
            className="relative"
          >
            <Card className="border-gray-200 hover:shadow-md transition-shadow cursor-help">
              <CardContent className="pt-5 pb-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    {label}
                  </p>
                  <motion.p
                    className="text-2xl font-bold text-gray-900 tabular-nums"
                    animate={
                      flash
                        ? {
                            backgroundColor:
                              improved === true
                                ? ['rgba(34,197,94,0)', 'rgba(34,197,94,0.15)', 'rgba(34,197,94,0)']
                                : improved === false
                                ? ['rgba(251,191,36,0)', 'rgba(251,191,36,0.15)', 'rgba(251,191,36,0)']
                                : [],
                          }
                        : {}
                    }
                    transition={{ duration: 0.15 }}
                  >
                    {displayValue}
                  </motion.p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs bg-gray-900 text-white text-xs p-2.5"
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AnimatedMetricsRow({
  stats,
  previousStats,
}: AnimatedMetricsRowProps) {
  const metrics = [
    {
      label: 'Win Rate',
      value: stats.win_rate,
      previousValue: previousStats?.win_rate,
      format: (v: number) => `${(v * 100).toFixed(1)}%`,
      tooltip: 'Percentage of trades that closed profitably (hit TP before SL)',
      improved:
        previousStats && stats.win_rate > previousStats.win_rate
          ? true
          : previousStats && stats.win_rate < previousStats.win_rate
          ? false
          : undefined,
    },
    {
      label: 'Expectancy (R)',
      value: stats.expectancy,
      previousValue: previousStats?.expectancy,
      format: (v: number) => v.toFixed(3),
      tooltip:
        'Average profit per trade in risk units. E.g., 0.200R means you make 20% of your risk per trade on average',
      improved:
        previousStats && stats.expectancy > previousStats.expectancy
          ? true
          : previousStats && stats.expectancy < previousStats.expectancy
          ? false
          : undefined,
    },
    {
      label: 'Max Drawdown',
      value: stats.max_drawdown_pct,
      previousValue: previousStats?.max_drawdown_pct,
      format: (v: number) => `${v.toFixed(1)}%`,
      tooltip: 'Worst peak-to-trough decline in equity during the backtest period',
      improved:
        previousStats && stats.max_drawdown_pct < previousStats.max_drawdown_pct
          ? true
          : previousStats && stats.max_drawdown_pct > previousStats.max_drawdown_pct
          ? false
          : undefined,
    },
    {
      label: 'Total Trades',
      value: stats.trades,
      previousValue: previousStats?.trades,
      format: (v: number) => Math.round(v).toString(),
      tooltip: 'Total number of completed trades in the backtest',
      improved: undefined,
    },
    {
      label: 'Profit Factor',
      value: stats.profit_factor ?? 0,
      previousValue: previousStats?.profit_factor ?? undefined,
      format: (v: number) =>
        !Number.isFinite(v)
          ? '∞'
          : v === 0
          ? '-'
          : v.toFixed(2),
      tooltip:
        'Profit Factor = gross profit / gross loss. Above 1.5 is strong, 1.0–1.5 is acceptable, below 1.0 is weak.',
      improved:
        previousStats && (stats.profit_factor ?? 0) > (previousStats.profit_factor ?? 0)
          ? true
          : previousStats && (stats.profit_factor ?? 0) < (previousStats.profit_factor ?? 0)
          ? false
          : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {metrics.map((metric, idx) => (
        <motion.div
          key={metric.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05, duration: 0.2 }}
        >
          <AnimatedMetricCard {...metric} />
        </motion.div>
      ))}
    </div>
  );
}
