'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface TokenUsageChartProps {
  data: Array<{
    date: string;
    'gpt-4': number;
    'gpt-3.5': number;
    'claude-3': number;
  }>;
}

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="date" 
          stroke="#6b7280"
          fontSize={12}
        />
        <YAxis 
          stroke="#6b7280"
          fontSize={12}
          tickFormatter={(value) => `${value / 1000}k`}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff', 
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
          formatter={(value?: number) => [value?.toLocaleString() ?? '0', '']}
        />
        <Legend />
        <Bar dataKey="gpt-4" fill="#3b82f6" />
        <Bar dataKey="gpt-3.5" fill="#10b981" />
        <Bar dataKey="claude-3" fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}
