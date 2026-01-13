'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { SignalPublishingFaqDialog } from '@/components/faq/signal-publishing-faq-dialog';

interface EquityPoint {
  date: string;
  equity: number;
}

interface PerformanceSummary {
  equity_curve: EquityPoint[];
}

interface EquityChartProps {
  summary: PerformanceSummary;
}

type ChartTooltipPayload = {
  value?: number;
  payload?: { formattedDate?: string };
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}

function EquityChartTooltip({ active, payload }: ChartTooltipProps) {
  if (active && payload && payload.length) {
    const point = payload[0];
    const value = typeof point?.value === 'number' ? point.value : null;
    const formattedDate = (point?.payload as { formattedDate?: string })?.formattedDate;
    if (value != null) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          {formattedDate && <p className="text-xs text-gray-600 mb-1">{formattedDate}</p>}
          <p className="text-sm font-semibold text-gray-900">
            ${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
        </div>
      );
    }
  }
  return null;
}

export default function EquityChart({ summary }: EquityChartProps) {
  if (!summary.equity_curve || summary.equity_curve.length === 0) {
    return (
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <span>Equity Curve</span>
            </div>
            <SignalPublishingFaqDialog />
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-sm text-gray-500">No equity data available yet</p>
        </CardContent>
      </Card>
    );
  }

  // Format data for Recharts
  const chartData = summary.equity_curve.map((point) => {
    const date = new Date(point.date);
    return {
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      equity: point.equity,
      formattedDate: date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      }),
    };
  });


  return (
    <Card className="border-gray-200">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <span>Equity Curve</span>
          </div>
          <SignalPublishingFaqDialog />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="date" 
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip content={<EquityChartTooltip />} />
            <Line 
              type="monotone" 
              dataKey="equity" 
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
