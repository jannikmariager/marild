'use client';

import React from 'react';

interface VersionCardProps {
  version: string;
  notes?: string | null;
  metrics?: any;
}

export const VersionCard: React.FC<VersionCardProps> = ({ version, notes, metrics }) => {
  return (
    <div className="border border-slate-800 rounded-md p-3 bg-slate-900/60 space-y-1">
      <div className="font-semibold text-white">{version}</div>
      {notes && <div className="text-xs text-slate-400">{notes}</div>}
      {metrics && (
        <div className="text-xs text-slate-400">
          avg PnL: {(metrics.avg_pnl ?? 0).toFixed(2)} · Win%: {(metrics.avg_win_rate ?? 0).toFixed(1)} · Max DD:{' '}
          {(metrics.avg_max_dd ?? 0).toFixed(1)}
        </div>
      )}
    </div>
  );
};
