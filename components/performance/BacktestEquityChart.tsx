'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip as UITooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, HelpCircle } from 'lucide-react';

interface EquityPoint {
  date: string;
  equity: number;
}

interface BenchmarkCurves {
  SPY?: EquityPoint[];
  QQQ?: EquityPoint[];
}

interface BacktestEquityChartProps {
  data: EquityPoint[] | null;
  horizonLabel: string;
  benchmarks?: BenchmarkCurves | null;
}

type ChartTooltipPayload = {
  value?: number;
  payload?: {
    formattedDate?: string;
  };
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}

function BacktestEquityTooltip({ active, payload }: ChartTooltipProps) {
  if (active && payload && payload.length) {
    const point = payload[0];
    const value = typeof point?.value === 'number' ? point.value : null;
    const formattedDate = (point?.payload as { formattedDate?: string })?.formattedDate;
    if (value != null) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          {formattedDate && <p className="text-xs text-gray-600 mb-1">{formattedDate}</p>}
          <p className="text-sm font-semibold text-gray-900">
            ${value.toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
      );
    }
  }
  return null;
}

export default function BacktestEquityChart({ data, horizonLabel, benchmarks }: BacktestEquityChartProps) {
  const [showSpy, setShowSpy] = useState(true);
  const [showQqq, setShowQqq] = useState(true);

  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const hasData = safeData.length > 0;

  const sampledData = useMemo(() => {
    if (safeData.length > 500) {
      const step = Math.ceil(safeData.length / 500);
      return safeData.filter((_, idx) => idx % step === 0);
    }
    return safeData;
  }, [safeData]);

  const benchmarkMaps = useMemo(() => {
    const maps: Record<string, Map<string, number>> = {};
    if (!benchmarks) return maps;

    if (benchmarks.SPY) {
      const map = new Map<string, number>();
      for (const pt of benchmarks.SPY) {
        const key = new Date(pt.date).toISOString().slice(0, 10);
        map.set(key, pt.equity);
      }
      maps.SPY = map;
    }

    if (benchmarks.QQQ) {
      const map = new Map<string, number>();
      for (const pt of benchmarks.QQQ) {
        const key = new Date(pt.date).toISOString().slice(0, 10);
        map.set(key, pt.equity);
      }
      maps.QQQ = map;
    }

    return maps;
  }, [benchmarks]);

  const chartData = useMemo(() => {
    return sampledData.map((point) => {
      const date = new Date(point.date);
      const key = date.toISOString().slice(0, 10);
      return {
        date: date.toISOString(),
        displayDate: `${date.getMonth() + 1}/${date.getDate()}`,
        equity: point.equity,
        spy: benchmarkMaps.SPY?.get(key),
        qqq: benchmarkMaps.QQQ?.get(key),
        formattedDate: date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };
    });
  }, [sampledData, benchmarkMaps]);

  const { yMin, yMax } = useMemo(() => {
    const allValues: number[] = [];
    for (const point of chartData) {
      if (Number.isFinite(point.equity)) allValues.push(point.equity);
      if (Number.isFinite(point.spy)) allValues.push(point.spy as number);
      if (Number.isFinite(point.qqq)) allValues.push(point.qqq as number);
    }
    const minEquity = allValues.length ? Math.min(...allValues) : 0;
    const maxEquity = allValues.length ? Math.max(...allValues) : 1;
    const range = maxEquity - minEquity || maxEquity || 1;
    const lower = Math.max(80000, minEquity - range * 0.1);
    const upper = maxEquity + range * 0.1;
    return { yMin: lower, yMax: upper };
  }, [chartData]);

  if (!hasData) {
    return (
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <span>Backtest equity curve</span>
            </div>
            <UITooltip>
              <TooltipTrigger asChild>
                <button className="inline-flex items-center justify-center">
                  <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-sm">
                Simulated equity growth for this ticker and trading style based on historical signals. Backtests are
                hypothetical and do not guarantee future performance.
              </TooltipContent>
            </UITooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[240px] flex items-center justify-center">
          <p className="text-sm text-gray-500">No backtest equity data available yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gray-200">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <span>Backtest equity curve ({horizonLabel})</span>
          </div>
          <div className="flex items-center gap-3">
            {benchmarks && (benchmarks.SPY || benchmarks.QQQ) && (
              <div className="inline-flex rounded-full bg-white border border-gray-200 p-1 text-[11px] font-medium text-gray-600">
                {benchmarks.SPY && (
                  <button
                    type="button"
                    onClick={() => setShowSpy((v) => !v)}
                    className={`px-2.5 py-0.5 rounded-full flex items-center gap-1 border border-transparent ${
                      showSpy ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#6b7280' }} />
                    SPY
                  </button>
                )}
                {benchmarks.QQQ && (
                  <button
                    type="button"
                    onClick={() => setShowQqq((v) => !v)}
                    className={`px-2.5 py-0.5 rounded-full flex items-center gap-1 border border-transparent ml-1 ${
                      showQqq ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#7c3aed' }} />
                    QQQ
                  </button>
                )}
              </div>
            )}
            <UITooltip>
              <TooltipTrigger asChild>
                <button className="inline-flex items-center justify-center">
                  <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-sm">
                Simulated equity growth if every historical signal for this ticker and trading style was executed with
                fixed risk. Past performance does not guarantee future results.
              </TooltipContent>
            </UITooltip>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              tickFormatter={(isoDate) => {
                const d = new Date(isoDate);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              domain={[yMin, yMax]}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip content={<BacktestEquityTooltip />} />
            <Line
              type="monotone"
              dataKey="equity"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />

            {benchmarks?.SPY && showSpy && (
              <Line type="monotone" dataKey="spy" stroke="#6b7280" strokeWidth={1.6} dot={false} />
            )}

            {benchmarks?.QQQ && showQqq && (
              <Line type="monotone" dataKey="qqq" stroke="#7c3aed" strokeWidth={1.6} dot={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
