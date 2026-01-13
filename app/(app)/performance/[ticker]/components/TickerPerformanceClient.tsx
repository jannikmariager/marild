'use client';

import { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import TickerPerformanceSkeleton from './TickerPerformanceSkeleton';
import AnimatedErrorState from './AnimatedErrorState';

interface TickerStats {
  ticker: string;
  trades: number;
  win_rate: number;
  expectancy: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
}

interface TickerData {
  ticker: string;
  horizons: string[];
  stats: Record<string, TickerStats>;
}

interface TickerPerformanceClientProps {
  ticker: string;
}

export default function TickerPerformanceClient({ ticker }: TickerPerformanceClientProps) {
  const [data, setData] = useState<TickerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    loadTickerData();
  }, [ticker]);

  async function loadTickerData() {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch ticker-specific coverage/eligibility data (performance fields ignored in UI)
      const response = await fetch(`/api/performance/universe`);
      if (!response.ok) {
        throw new Error('Failed to load coverage data');
      }

      const payload = await response.json();
      const tickerData = payload.tickers?.find(
        (t: any) => t.ticker.toUpperCase() === ticker.toUpperCase()
      );

      if (!tickerData) {
        throw new Error(`No coverage data found for ${ticker}`);
      }

      setData({
        ticker: tickerData.ticker,
        horizons: tickerData.horizons || [],
        stats: tickerData.stats || {},
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticker data');
    } finally {
      setIsLoading(false);
    }
  }

  // Animation variants for staggered entry
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.08,
      },
    },
  };
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: shouldReduceMotion ? 0.15 : 0.25,
        ease: 'easeOut',
      },
    },
  };

  // Tab content animation
  const tabContentVariants = {} as const; // no tab animations needed in coverage view

  if (isLoading) {
    return <TickerPerformanceSkeleton />;
  }

  if (error || !data) {
    return (
      <AnimatedErrorState
        message={error || 'No data available'}
        onRetry={loadTickerData}
      />
    );
  }

  const horizons = data.horizons || [];
  const hasAnyHistory = Object.values(data.stats || {}).length > 0;

  const status = horizons.length === 0 ? 'Experimental' : horizons.includes('day') || horizons.includes('swing') ? 'Eligible' : 'Limited';
  const avgTrades = hasAnyHistory
    ? Object.values(data.stats).reduce((sum, s) => sum + (s.trades || 0), 0) /
      Object.values(data.stats).length
    : 0;
  const frequency = avgTrades >= 80 ? 'High' : avgTrades >= 30 ? 'Medium' : 'Low';

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Breadcrumb + Back Link */}
      <motion.div variants={itemVariants} className="flex items-center gap-2 text-sm text-gray-600">
        <Link
          href="/performance"
          className="group inline-flex items-center gap-1 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          <span>Market Coverage &amp; Signal Eligibility</span>
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900 font-medium">{ticker}</span>
      </motion.div>

      {/* Coverage-focused banner */}
      <motion.div
        variants={itemVariants}
        className="bg-blue-50 border-l-4 border-blue-500 px-4 py-3 rounded-r"
      >
        <p className="text-sm font-semibold text-blue-900">
          Live performance for Active Signals is tracked on the Performance page.
        </p>
        <p className="text-xs text-blue-800 mt-1">
          This ticker view focuses on coverage, structure, and signal eligibility only — it does not display
          backtests, returns, or P&amp;L.
        </p>
      </motion.div>

      {/* Ticker coverage summary */}
      <motion.div variants={itemVariants} className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-gray-900">{ticker}</h1>
            <p className="text-sm text-gray-600">
              Monitored by the Marild engine for structural signal opportunities, liquidity conditions, and
              volatility regimes.
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-1 text-sm">
            <div>
              <span className="text-gray-500 mr-1">Signal status:</span>
              <span className="font-semibold text-gray-900">{status}</span>
            </div>
            <div>
              <span className="text-gray-500 mr-1">Signal frequency:</span>
              <span className="font-semibold text-gray-900">{frequency}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">How signals are evaluated on this symbol</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              For each monitored symbol, Marild evaluates structural price behavior, liquidity, and volatility
              patterns to decide when a potential setup is eligible for an Active Signal. The engine focuses on
              data quality, gap behavior, and trend consistency — not just raw backtested returns.
            </p>
            <p className="text-xs text-gray-500">
              Eligibility thresholds and internal quality scores may change over time as the engine adapts to
              new regimes and market conditions.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">Volatility, liquidity &amp; structure notes</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              This section describes how {ticker} typically trades from a structural standpoint — including its
              intraday liquidity profile, volatility clustering, and gap/overnight behavior. These traits help
              determine whether certain signal types are enabled or gated for this symbol.
            </p>
            <p className="text-xs text-gray-500">
              Exact thresholds and quantitative metrics are internal to the engine and are not displayed here.
              The goal is to indicate <span className="font-semibold">eligibility</span>, not to advertise
              performance.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
