'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

interface ComparisonCell {
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
}

interface ComparisonMatrix {
  tickers: string[];
  versions: string[];
  matrix: Record<string, Record<string, ComparisonCell>>;
}

// Raw "timeframe" values from reports map to trading styles
// day -> Daytrader, swing -> Swingtrader, invest -> Investing
const STYLE_OPTIONS = [
  { id: 'day', label: 'Daytrader' },
  { id: 'swing', label: 'Swingtrader' },
  { id: 'invest', label: 'Investing' },
] as const;

type StyleId = (typeof STYLE_OPTIONS)[number]['id'];

async function fetchMatrix(style: StyleId): Promise<ComparisonMatrix> {
  const params = new URLSearchParams({ timeframe: style });
  const res = await fetch(`/api/engines/compare?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load comparison matrix');
  return res.json();
}

function cellColor(cell: ComparisonCell | undefined): string {
  if (!cell || cell.pnl == null) return 'bg-muted';
  if (cell.pnl > 0) return 'bg-emerald-100 text-emerald-900';
  if (cell.pnl < 0) return 'bg-red-100 text-red-900';
  return 'bg-muted';
}

export const EngineComparisonMatrix: React.FC = () => {
  const [style, setStyle] = React.useState<StyleId>('swing');

  const { data, isLoading, error } = useQuery<ComparisonMatrix>({
    queryKey: ['engine-comparison-matrix', style],
    queryFn: () => fetchMatrix(style),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading matrix…</div>;
  if (error) return <div className="text-sm text-red-500">Error loading matrix</div>;
  if (!data) return null;

  const currentStyleLabel = STYLE_OPTIONS.find((s) => s.id === style)?.label ?? 'Unknown';

  return (
    <div className="space-y-4 overflow-auto bg-card rounded-lg p-4 border border-border">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Engine Comparison Matrix</h2>
          <p className="text-xs text-muted-foreground">Compare engine versions across tickers for a specific trading style.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Style:</span>
          <div className="inline-flex rounded-full bg-muted p-1">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStyle(opt.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  style === opt.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <table className="min-w-full text-xs border-collapse text-foreground">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card z-10 px-2 py-1 text-left text-muted-foreground">Ticker</th>
            {data.versions.map((v) => (
              <th key={v} className="px-2 py-1 text-center text-muted-foreground">
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.tickers.map((ticker) => (
            <tr key={ticker} className="border-t border-border">
              <td className="sticky left-0 bg-card z-10 px-2 py-1 font-medium">
                <Link
                  href={`/admin/engines/ticker/${encodeURIComponent(ticker)}`}
                  className="hover:underline text-primary"
                >
                  {ticker}
                </Link>
              </td>
              {data.versions.map((v) => {
                const cell = data.matrix[ticker]?.[v];
                const base = 'px-2 py-1 text-center';
                const tone = cellColor(cell);
                return (
                  <td key={v} className={`${base} ${tone}`}>
                    {cell?.pnl != null ? cell.pnl.toFixed(2) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[10px] text-muted-foreground mt-1">Currently showing: {currentStyleLabel} results.</p>
    </div>
  );
};
