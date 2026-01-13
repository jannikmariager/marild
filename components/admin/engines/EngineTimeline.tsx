'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

interface EngineVersion {
  id?: string;
  version: string;
  created_at: string;
  notes?: string | null;
  features?: any;
  metrics?: any;
  improvement_score?: number | null;
}

async function fetchVersions(): Promise<EngineVersion[]> {
  const res = await fetch('/api/engines');
  if (!res.ok) throw new Error('Failed to load engine versions');
  return res.json();
}

export const EngineTimeline: React.FC = () => {
  const { data, isLoading, error } = useQuery<EngineVersion[]>({
    queryKey: ['engine-versions'],
    queryFn: fetchVersions,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading versions…</div>;
  if (error) return <div className="text-sm text-red-500">Error loading versions</div>;

  return (
    <div className="space-y-4 bg-card rounded-lg p-4 border border-border">
      <h2 className="text-lg font-semibold text-foreground">Engine Evolution Timeline</h2>
      <div className="space-y-3">
        {data?.map((v) => (
          <div
            key={v.version}
            className="border border-border rounded-md p-3 bg-muted/40 flex items-center justify-between"
          >
            <div>
              <div className="font-medium text-foreground">
                <Link href={`/admin/engines/${encodeURIComponent(v.version)}`} className="hover:underline text-primary">
                  {v.version}
                </Link>
              </div>
              {v.notes && <div className="text-xs text-muted-foreground">{v.notes}</div>}
              {v.metrics && (
                <div className="mt-1 text-xs text-muted-foreground">
                  avg PnL: {(v.metrics.avg_pnl ?? 0).toFixed(2)} · avg Win%: {(v.metrics.avg_win_rate ?? 0).toFixed(1)}
                </div>
              )}
            </div>
            <div className="text-xs text-right text-muted-foreground">
              <div>{new Date(v.created_at).toLocaleDateString()}</div>
              {v.improvement_score != null && <div>Δ score: {v.improvement_score.toFixed(2)}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
