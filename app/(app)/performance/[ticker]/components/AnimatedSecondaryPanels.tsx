'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TickerStats {
  ticker: string;
  trades: number;
  win_rate: number;
  expectancy: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
}

interface AnimatedSecondaryPanelsProps {
  stats: TickerStats;
  ticker: string;
  horizon: string;
}

export default function AnimatedSecondaryPanels({
  stats,
  ticker,
  horizon,
}: AnimatedSecondaryPanelsProps) {
  // Calculate quality score (simple heuristic)
  const getQualityScore = (): number => {
    const expScore = Math.max(0, Math.min(3, stats.expectancy * 6));
    const winScore = Math.max(0, Math.min(2, (stats.win_rate - 0.5) * 4));
    const ddPenalty = stats.max_drawdown_pct > 40 ? -1 : stats.max_drawdown_pct > 30 ? -0.5 : 0;
    let total = expScore + winScore + ddPenalty;
    total = Math.max(0, Math.min(5, total));
    return Math.round(total);
  };

  const qualityScore = getQualityScore();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Quality Score */}
      <Card className="border-gray-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-gray-900">
              Quality Score
            </CardTitle>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              Backtesting Data
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    delay: idx * 0.1,
                    type: 'spring',
                    stiffness: 200,
                  }}
                >
                  <Star
                    className={cn(
                      'w-6 h-6 transition-colors',
                      idx < qualityScore
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-gray-200'
                    )}
                  />
                </motion.div>
              ))}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Score (0-5★) based on expectancy ({stats.expectancy.toFixed(3)}R), win rate ({(
                stats.win_rate * 100
              ).toFixed(1)}
              %), and max drawdown ({stats.max_drawdown_pct.toFixed(1)}%). Higher expectancy and win
              rate add stars; large drawdowns subtract stars.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card className="border-gray-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-gray-900">
              Performance Summary
            </CardTitle>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              Backtesting Data
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Ticker</span>
              <span className="text-sm font-semibold text-gray-900">{ticker}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Style</span>
              <span className="text-sm font-semibold text-gray-900">
                {horizon === 'day' ? 'DAYTRADE' : horizon === 'swing' ? 'SWING' : 'LIVE'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Sample Size</span>
              <span className="text-sm font-semibold text-gray-900">{stats.trades} trades</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Profit Factor</span>
              <span className="text-sm font-semibold text-gray-900">
                {stats.profit_factor == null
                  ? '–'
                  : Number.isFinite(stats.profit_factor)
                  ? stats.profit_factor.toFixed(2)
                  : '∞'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
