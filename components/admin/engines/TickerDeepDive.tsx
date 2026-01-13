'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';

interface EvolutionEntry {
  version: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
  trades_count: number | null;
}

interface TickerEvolutionResponse {
  ticker: string;
  entries: EvolutionEntry[];
}

function formatStyleLabel(timeframe: string): string {
  switch (timeframe) {
    case 'day':
      return 'Daytrader';
    case 'swing':
      return 'Swingtrader';
    case 'invest':
      return 'Investing';
    default:
      return timeframe;
  }
}

async function fetchTicker(symbol: string): Promise<TickerEvolutionResponse> {
  const res = await fetch(`/api/engines/ticker?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error('Failed to load ticker evolution');
  return res.json();
}

export const TickerDeepDive: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { data, isLoading, error } = useQuery<TickerEvolutionResponse>({
    queryKey: ['engine-ticker', symbol],
    queryFn: () => fetchTicker(symbol),
  });

  if (isLoading) return <div className="text-sm text-slate-400">Loading {symbol}…</div>;
  if (error) return <div className="text-sm text-red-500">Error loading {symbol}</div>;
  if (!data) return null;
 
   return (
    <div className="space-y-4 bg-card rounded-lg p-4 border border-border">
      <h2 className="text-lg font-semibold text-foreground">{data.ticker} Evolution</h2>
      <table className="w-full text-xs border-collapse text-foreground">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-muted-foreground">Version</th>
            <th className="px-2 py-1 text-left text-muted-foreground">Style</th>
            <th className="px-2 py-1 text-right text-muted-foreground">PnL</th>
            <th className="px-2 py-1 text-right text-muted-foreground">Win%</th>
            <th className="px-2 py-1 text-right text-muted-foreground">Max DD%</th>
            <th className="px-2 py-1 text-right text-muted-foreground">Avg R</th>
            <th className="px-2 py-1 text-right text-muted-foreground">Trades</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e, idx) => (
            <tr key={idx} className="border-t border-border">
              <td className="px-2 py-1">{e.version}</td>
              <td className="px-2 py-1">{formatStyleLabel(e.timeframe)}</td>
              <td className="px-2 py-1 text-right">{e.pnl != null ? e.pnl.toFixed(2) : '—'}</td>
              <td className="px-2 py-1 text-right">{e.win_rate != null ? e.win_rate.toFixed(1) : '—'}</td>
              <td className="px-2 py-1 text-right">{e.max_dd != null ? e.max_dd.toFixed(1) : '—'}</td>
              <td className="px-2 py-1 text-right">{e.avg_r != null ? e.avg_r.toFixed(3) : '—'}</td>
              <td className="px-2 py-1 text-right">{e.trades_count ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
   );
};
