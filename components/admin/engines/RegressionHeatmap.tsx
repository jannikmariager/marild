'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';

interface RegressionFlag {
  ticker: string;
  timeframe: string;
  version_prev: string;
  version_curr: string;
  // Optional list of textual reasons; may be missing when export only returns raw metrics
  reasons?: string[];
}

async function fetchRegressions(): Promise<RegressionFlag[]> {
  const res = await fetch('/api/engines/export?format=json');
  if (!res.ok) throw new Error('Failed to load regressions');
  return res.json();
}

export const RegressionHeatmap: React.FC = () => {
  const { data, isLoading, error } = useQuery<RegressionFlag[]>({
    queryKey: ['engine-regressions'],
    queryFn: fetchRegressions,
  });

  if (isLoading) return <div className="text-sm text-slate-400">Analyzing regressions…</div>;
  if (error) return <div className="text-sm text-red-500">Error loading regressions</div>;
  if (!data || data.length === 0)
    return <div className="text-sm text-slate-400">No regressions detected.</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Regression Heatmap</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((r, idx) => (
          <div key={idx} className="border border-red-900/60 rounded-md p-3 bg-red-950/40">
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold text-slate-100">{r.ticker}</span>
              <span className="text-slate-400">{r.timeframe}</span>
            </div>
            <div className="text-xs text-slate-400 mb-1">
              {r.version_prev} → {r.version_curr}
            </div>
            <div className="text-xs text-slate-100">
              {(r.reasons && r.reasons.length > 0)
                ? r.reasons.join(', ')
                : 'No detailed regression reasons recorded'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
