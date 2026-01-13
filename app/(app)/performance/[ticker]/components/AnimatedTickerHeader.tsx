'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AnimatedTickerHeaderProps {
  ticker: string;
  liveEnabled: boolean;
  approvedStyles: string[];
}

const horizonColors: Record<string, string> = {
  day: 'bg-orange-100 text-orange-700 border-orange-200',
  swing: 'bg-blue-100 text-blue-700 border-blue-200',
  invest: 'bg-purple-100 text-purple-700 border-purple-200',
};

const formatHorizon = (h: string): string => {
  if (h === 'day') return 'DAYTRADE';
  if (h === 'swing') return 'SWING';
  if (h === 'invest') return 'INVESTOR';
  return h.toUpperCase();
};

export default function AnimatedTickerHeader({
  ticker,
  liveEnabled,
  approvedStyles,
}: AnimatedTickerHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      {/* Left: Ticker + Badges */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-900">{ticker}</h1>
          {liveEnabled && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="inline-flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded-full"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="w-1.5 h-1.5 bg-green-500 rounded-full"
              />
              <span className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">
                Live
              </span>
            </motion.div>
          )}
        </div>

        {/* Approved Styles Badges */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold text-gray-600 self-center">Approved for:</span>
          {approvedStyles.map((horizon, idx) => (
            <motion.span
              key={horizon}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 + idx * 0.05 }}
              className={cn(
                'inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-semibold',
                horizonColors[horizon] || 'bg-gray-100 text-gray-700 border-gray-200'
              )}
            >
              {formatHorizon(horizon)}
            </motion.span>
          ))}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="group border-gray-200 hover:border-gray-300 hover:bg-gradient-to-r hover:from-gray-50 hover:to-white"
        >
          <Link href={`/markets/${ticker.toLowerCase()}`}>
            <span>View in Markets</span>
            <ExternalLink className="w-3.5 h-3.5 ml-1.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
