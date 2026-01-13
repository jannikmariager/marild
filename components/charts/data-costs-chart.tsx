'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DataCostsChartProps {
  data: Array<{
    date: string;
    tradingView: number;
    alphaVantage: number;
    polygon: number;
  }>;
}

export function DataCostsChart({ data }: DataCostsChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="date" 
          stroke="#6b7280"
          fontSize={12}
        />
        <YAxis 
          stroke="#6b7280"
          fontSize={12}
          tickFormatter={(value) => `$${value}`}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff', 
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
          formatter={(value: number) => [`$${value}`, '']}
        />
        <Legend />
        <Line 
          type="monotone" 
          dataKey="tradingView" 
          stroke="#3b82f6" 
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line 
          type="monotone" 
          dataKey="alphaVantage" 
          stroke="#10b981" 
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line 
          type="monotone" 
          dataKey="polygon" 
          stroke="#f59e0b" 
          strokeWidth={2}
          dot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
