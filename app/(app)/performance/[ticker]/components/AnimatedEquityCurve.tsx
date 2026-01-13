'use client';

import { useState, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot } from 'recharts';
import { format, subMonths } from 'date-fns';

interface EquityPoint {
  date: string;
  equity: number;
}

interface BenchmarkSeries {
  name: string; // e.g. 'SPY', 'QQQ'
  data: EquityPoint[];
}

interface AnimatedEquityCurveProps {
  data: EquityPoint[];
  horizon: string;
  benchmarks?: BenchmarkSeries[];
}

type ZoomRange = '3m' | '6m' | '1y' | 'all';

export default function AnimatedEquityCurve({ data, horizon, benchmarks }: AnimatedEquityCurveProps) {
  const shouldReduceMotion = useReducedMotion();
  const [zoomRange, setZoomRange] = useState<ZoomRange>('all');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showSpy, setShowSpy] = useState(true);
  const [showQqq, setShowQqq] = useState(true);

  // Build quick lookup maps for benchmarks by date (ISO date-only key)
  const benchmarkMaps = useMemo(() => {
    if (!benchmarks || !benchmarks.length) return {} as Record<string, Map<string, number>>;
    const maps: Record<string, Map<string, number>> = {};
    for (const b of benchmarks) {
      const m = new Map<string, number>();
      for (const pt of b.data) {
        const dKey = new Date(pt.date).toISOString().slice(0, 10);
        m.set(dKey, pt.equity);
      }
      maps[b.name] = m;
    }
    return maps;
  }, [benchmarks]);

  // Filter data based on zoom range
  const filteredData = useMemo(() => {
    if (zoomRange === 'all' || data.length === 0) return data;

    const now = new Date();
    const cutoffDate = subMonths(now, zoomRange === '3m' ? 3 : zoomRange === '6m' ? 6 : 12);

    return data.filter((point) => new Date(point.date) >= cutoffDate);
  }, [data, zoomRange]);

  // Merge benchmarks into chart data rows
  const chartData = useMemo(() => {
    return filteredData.map((pt) => {
      const row: any = { ...pt };
      const key = new Date(pt.date).toISOString().slice(0, 10);
      if (benchmarkMaps.SPY?.has(key)) {
        row.spy = benchmarkMaps.SPY.get(key);
      }
      if (benchmarkMaps.QQQ?.has(key)) {
        row.qqq = benchmarkMaps.QQQ.get(key);
      }
      return row;
    });
  }, [filteredData, benchmarkMaps]);

  // Calculate return for strategy line only
  const startEquity = chartData[0]?.equity || 100000;
  const endEquity = chartData[chartData.length - 1]?.equity || 100000;
  const returnPct = ((endEquity - startEquity) / startEquity) * 100;

  const zoomOptions: { value: ZoomRange; label: string }[] = [
    { value: '3m', label: '3M' },
    { value: '6m', label: '6M' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' },
  ];

  return (
    <Card className="border-gray-200">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-semibold text-gray-900">Equity Curve</CardTitle>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                Backtesting Data
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              {horizon === 'day' ? 'Daytrader' : horizon === 'swing' ? 'Swing' : 'Live'} model
              historical backtest performance
            </p>
          </div>

          {/* Zoom Controls + Benchmark Toggles */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4 gap-2">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex rounded-full bg-gray-100 p-1 text-xs font-medium"
            >
              {zoomOptions.map((option) => (
                <motion.button
                  key={option.value}
                  onClick={() => setZoomRange(option.value)}
                  whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
                  whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                  className={`px-3 py-1 rounded-full transition-colors ${
                    zoomRange === option.value
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'text-gray-700 hover:bg-white'
                  }`}
                >
                  {option.label}
                </motion.button>
              ))}
            </motion.div>

            {benchmarks && benchmarks.length > 0 && (
              <div className="inline-flex rounded-full bg-white border border-gray-200 p-1 text-[11px] font-medium text-gray-600">
                {benchmarkMaps.SPY && (
                  <button
                    type="button"
                    onClick={() => setShowSpy((v) => !v)}
                    className={`px-3 py-0.5 rounded-full flex items-center gap-1 border border-transparent ${
                      showSpy ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: '#6b7280' }}
                    />
                    SPY
                  </button>
                )}
                {benchmarkMaps.QQQ && (
                  <button
                    type="button"
                    onClick={() => setShowQqq((v) => !v)}
                    className={`px-3 py-0.5 rounded-full flex items-center gap-1 border border-transparent ml-1 ${
                      showQqq ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: '#7c3aed' }}
                    />
                    QQQ
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Return Badge */}
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 w-fit"
        >
          <span className="text-[11px] font-medium text-gray-600">Return:</span>
          <span
            className={`text-[11px] font-bold ${
              returnPct >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {returnPct >= 0 ? '+' : ''}
            {returnPct.toFixed(2)}%
          </span>
        </motion.div>
      </CardHeader>

      <CardContent>
        <motion.div
          key={zoomRange}
          initial={shouldReduceMotion ? {} : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <ResponsiveContainer width="100%" height={380}>
            <LineChart
              data={chartData}
              onMouseMove={(e: any) => {
                if (e && e.activeTooltipIndex !== undefined) {
                  setHoveredIndex(e.activeTooltipIndex);
                }
              }}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

              <XAxis
                dataKey="date"
                tickFormatter={(value) => format(new Date(value), 'MMM d')}
                stroke="#9ca3af"
                style={{ fontSize: '11px' }}
                tick={{ fill: '#6b7280' }}
              />

              <YAxis
                stroke="#9ca3af"
                style={{ fontSize: '11px' }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                tick={{ fill: '#6b7280' }}
              />

              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;

                  const point = payload[0].payload;
                  const equity = point.equity;
                  const returnPct = ((equity - startEquity) / startEquity) * 100;

                  return (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.1 }}
                      className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 space-y-1.5"
                    >
                      <p className="text-xs font-medium text-gray-600">
                        {format(new Date(point.date), 'MMM d, yyyy')}
                      </p>
                      <p className="text-sm font-bold text-gray-900">
                        ${equity.toLocaleString()}
                      </p>
                      <p
                        className={`text-xs font-semibold ${
                          returnPct >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {returnPct >= 0 ? '+' : ''}
                        {returnPct.toFixed(2)}% return
                      </p>
                    </motion.div>
                  );
                }}
              />

              <Line
                type="monotone"
                dataKey="equity"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                activeDot={
                  <Dot
                    r={5}
                    fill="#3b82f6"
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                }
                animationDuration={shouldReduceMotion ? 0 : 700}
                animationEasing="ease-out"
                fill="url(#equityGradient)"
              />

              {benchmarkMaps.SPY && showSpy && (
                <Line
                  type="monotone"
                  dataKey="spy"
                  stroke="#6b7280"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={!shouldReduceMotion}
                />
              )}

              {benchmarkMaps.QQQ && showQqq && (
                <Line
                  type="monotone"
                  dataKey="qqq"
                  stroke="#7c3aed"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={!shouldReduceMotion}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </CardContent>
    </Card>
  );
}
