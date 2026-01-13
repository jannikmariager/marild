'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface SummaryRow {
  version: string;
  ticker: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
  trades_total?: number | null;
}

interface SummaryPayload {
  versions: string[];
  styles: ('DAYTRADER' | 'SWING' | 'INVESTOR')[];
  summary: Record<string, Record<string, any>>;
  rows: SummaryRow[];
}

async function fetchSummary(): Promise<SummaryPayload> {
  const res = await fetch('/api/engines/summary');
  if (!res.ok) throw new Error('Failed to load engine summary');
  return res.json();
}

const STYLE_LABELS: Record<string, string> = {
  DAYTRADER: 'Daytrader (intraday)',
  SWING: 'Swing (multi-day)',
  INVESTOR: 'Investor (long-term)',
};

function styleForTimeframe(tfRaw: string): 'DAYTRADER' | 'SWING' | 'INVESTOR' {
  const tf = tfRaw.toLowerCase();
  if (tf === 'day' || tf === 'daytrader') return 'DAYTRADER';
  if (tf === 'swing' || tf === 'swingtrader') return 'SWING';
  return 'INVESTOR';
}

// Limit the UI to the new modular engines; older versions are hidden by default.
// Add new versions here as you create them (e.g., 'V5.1', 'V5.2', etc.)
const TARGET_VERSIONS = ['V4.8', 'V4.9', 'V5.0', 'V5.1', 'V6.0', 'V6.1'] as const;

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type EngineStats = {
  version: string;
  avgR: number;
  trades: number;
  winRate: number;
  maxDrawdown: number;
};

function getBestVersionFromStats(stats: EngineStats[]): string | null {
  const candidates = stats.filter((s) => {
    if (s.trades < 5) return false;
    if (s.avgR <= 0) return false;
    if (s.winRate < 40) return false;
    if (s.maxDrawdown > 25) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    if (c.avgR > best.avgR) best = c;
  }
  return best.version;
}

function computeBestVersionForRow(
  row: SummaryRow,
  allRows: SummaryRow[],
  versionsToShow: string[],
): string | null {
  const stats: EngineStats[] = [];
  for (const v of versionsToShow) {
    const m = allRows.find(
      (r) => r.version === v && r.ticker === row.ticker && r.timeframe === row.timeframe,
    );
    if (!m || m.avg_r == null) continue;
    const avgR = Number(m.avg_r ?? 0);
    const trades = Number(m.trades_total ?? 0);
    const winRate = Number(m.win_rate ?? 0);
    const maxDrawdown = Number(m.max_dd ?? 0);
    if (!Number.isFinite(avgR)) continue;
    stats.push({ version: v, avgR, trades, winRate, maxDrawdown });
  }
  return getBestVersionFromStats(stats);
}

function exportToCSV(
  detailRows: SummaryRow[],
  allRows: SummaryRow[],
  versionsToShow: string[],
  selectedStyle: string,
) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const filename = `engine_comparison_${selectedStyle.toLowerCase()}_${timestamp}.csv`;

  // Build CSV header
  const headers = [
    'Ticker', 'Timeframe',
    ...versionsToShow.map(v => `${v}_avgR`),
    ...versionsToShow.map(v => `${v}_trades`),
    ...versionsToShow.map(v => `${v}_win%`),
    ...versionsToShow.map(v => `${v}_dd%`),
    'Best_Engine'
  ];
  const rows: string[][] = [headers];

  // Build CSV rows
  for (const row of detailRows) {
    const csvRow: string[] = [row.ticker, row.timeframe];
    
    // Build version map for this ticker/timeframe
    const byVersion: Record<string, SummaryRow | undefined> = {};
    for (const v of versionsToShow) {
      byVersion[v] = allRows.find(
        (r) => r.version === v && r.ticker === row.ticker && r.timeframe === row.timeframe,
      );
    }

    // Add avgR values
    for (const v of versionsToShow) {
      const match = byVersion[v];
      csvRow.push(match?.avg_r != null ? match.avg_r.toFixed(2) : '');
    }

    // Add trades values
    for (const v of versionsToShow) {
      const match = byVersion[v];
      csvRow.push(match?.trades_total != null ? match.trades_total.toString() : '');
    }

    // Add win% values
    for (const v of versionsToShow) {
      const match = byVersion[v];
      csvRow.push(match?.win_rate != null ? match.win_rate.toFixed(1) : '');
    }

    // Add dd% values
    for (const v of versionsToShow) {
      const match = byVersion[v];
      csvRow.push(match?.max_dd != null ? match.max_dd.toFixed(1) : '');
    }

    // Determine best engine using strict selection rules
    const stats: EngineStats[] = [];
    for (const v of versionsToShow) {
      const m = byVersion[v];
      if (!m || m.avg_r == null) continue;
      const avgR = Number(m.avg_r ?? 0);
      const trades = Number(m.trades_total ?? 0);
      const winRate = Number(m.win_rate ?? 0);
      const maxDrawdown = Number(m.max_dd ?? 0);
      if (!Number.isFinite(avgR)) continue;
      stats.push({ version: v, avgR, trades, winRate, maxDrawdown });
    }
    const bestVersion = getBestVersionFromStats(stats) ?? '';
    csvRow.push(bestVersion);

    rows.push(csvRow);
  }

  const csvContent = rows.map(r => r.join(',')).join('\n');
  downloadFile(csvContent, filename, 'text/csv');
}

function exportToJSON(
  detailRows: SummaryRow[],
  allRows: SummaryRow[],
  versionsToShow: string[],
  selectedStyle: string,
) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const filename = `engine_comparison_${selectedStyle.toLowerCase()}_${timestamp}.json`;

  const exportData = detailRows.map((row) => {
    const byVersion: Record<string, any> = {};
    
    for (const v of versionsToShow) {
      const match = allRows.find(
        (r) => r.version === v && r.ticker === row.ticker && r.timeframe === row.timeframe,
      );
      
      if (match) {
        byVersion[v] = {
          avg_r: match.avg_r,
          trades_total: match.trades_total,
          win_rate: match.win_rate,
          max_dd: match.max_dd,
          pnl: match.pnl,
        };
      }
    }

    // Determine best engine with strict rules
    const stats: EngineStats[] = [];
    for (const v of versionsToShow) {
      const m = byVersion[v];
      if (!m || m.avg_r == null) continue;
      const avgR = Number(m.avg_r ?? 0);
      const trades = Number(m.trades_total ?? 0);
      const winRate = Number(m.win_rate ?? 0);
      const maxDrawdown = Number(m.max_dd ?? 0);
      if (!Number.isFinite(avgR)) continue;
      stats.push({ version: v, avgR, trades, winRate, maxDrawdown });
    }

    const bestVersion = getBestVersionFromStats(stats);

    return {
      ticker: row.ticker,
      timeframe: row.timeframe,
      style: selectedStyle,
      engines: byVersion,
      best_engine: bestVersion,
    };
  });

  const jsonContent = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      style: selectedStyle,
      versions: versionsToShow,
      results: exportData,
    },
    null,
    2,
  );

  downloadFile(jsonContent, filename, 'application/json');
}

function getBestVersionForRow(
  row: SummaryRow,
  allRows: SummaryRow[],
  versionsToShow: string[],
): string | null {
  return computeBestVersionForRow(row, allRows, versionsToShow);
}

export const SimpleEngineTable: React.FC = () => {
  const { data, isLoading, error } = useQuery<SummaryPayload>({
    queryKey: ['engine-style-summary'],
    queryFn: fetchSummary,
  });

  const [selectedStyle, setSelectedStyle] = useState<'DAYTRADER' | 'SWING' | 'INVESTOR'>('DAYTRADER');
  const [bestFilter, setBestFilter] = useState<string>('ALL');

  const versionsToShow = useMemo(() => {
    if (!data) return [] as string[];
    const present = new Set(data.versions);
    const filtered = TARGET_VERSIONS.filter((v) => present.has(v));
    // If none of the target versions exist yet (e.g. before ingestion),
    // fall back to showing whatever is available so the table is not empty.
    return filtered.length > 0 ? filtered : data.versions;
  }, [data]);

  const detailRows = useMemo(() => {
    if (!data) return [];
    // Filter by style, then group by ticker+timeframe so each row appears once
    const filtered = data.rows.filter(
      (row) => styleForTimeframe(row.timeframe) === selectedStyle,
    );
    const byKey = new Map<string, SummaryRow>();
    for (const r of filtered) {
      const key = `${r.ticker}-${r.timeframe}`;
      if (!byKey.has(key)) {
        byKey.set(key, r);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => {
      const t = a.ticker.localeCompare(b.ticker);
      if (t !== 0) return t;
      return a.timeframe.localeCompare(b.timeframe);
    });
  }, [data, selectedStyle]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (bestFilter === 'ALL') return detailRows;

    return detailRows.filter((row) => {
      const bestVersion = getBestVersionForRow(row, data.rows, versionsToShow);
      return bestVersion === bestFilter;
    });
  }, [data, detailRows, bestFilter, versionsToShow]);

  if (isLoading) return <div className="text-sm text-slate-400">Loading engine results…</div>;
  if (error) return <div className="text-sm text-red-500">Error loading engine results</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Engine results by style & ticker</h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            Each row is a ticker + timeframe for the selected trading style. Columns are engine
            versions. Cells show: <span className="font-mono">avgR · win% · dd%</span> so you can
            quickly see which engine is better for that style & ticker.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Style:</span>
            <select
              value={selectedStyle}
              onChange={(e) => setSelectedStyle(e.target.value as any)}
              className="border border-slate-300 bg-white px-2 py-1 rounded-md text-xs"
            >
              {data.styles.map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Best engine:</span>
            <select
              value={bestFilter}
              onChange={(e) => setBestFilter(e.target.value)}
              className="border border-slate-300 bg-white px-2 py-1 rounded-md text-xs"
            >
              <option value="ALL">All</option>
              {versionsToShow.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportToCSV(filteredRows, data.rows, versionsToShow, selectedStyle)}
              className="border border-slate-300 bg-white px-3 py-1 rounded-md hover:bg-slate-50 transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={() => exportToJSON(filteredRows, data.rows, versionsToShow, selectedStyle)}
              className="border border-slate-300 bg-white px-3 py-1 rounded-md hover:bg-slate-50 transition-colors"
            >
              Export JSON
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-auto border border-slate-200 rounded-md max-h-[600px] bg-white">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="px-1.5 py-1 text-left">Ticker</th>
              <th className="px-1.5 py-1 text-left">Timeframe</th>
              {versionsToShow.map((v) => (
                <th key={v} className="px-1.5 py-1 text-center whitespace-nowrap">{v}</th>
              ))}
              <th className="px-1.5 py-1 text-center whitespace-nowrap">Best</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              // Build a map of engine version -> metrics for this ticker/timeframe
              const byVersion: Record<string, SummaryRow | undefined> = {};
              for (const v of versionsToShow) {
                byVersion[v] = data.rows.find(
                  (r) =>
                    r.version === v &&
                    r.ticker === row.ticker &&
                    r.timeframe === row.timeframe,
                );
              }

              // Determine best engine by highest avgR (ignoring null/NaN)
              let bestVersion: string | null = null;
              let bestAvgR = -Infinity;
              for (const v of versionsToShow) {
                const m = byVersion[v];
                if (!m || m.avg_r == null) continue;
                const val = Number(m.avg_r);
                if (!Number.isFinite(val)) continue;
                if (val > bestAvgR) {
                  bestAvgR = val;
                  bestVersion = v;
                }
              }

              return (
                <tr key={`${row.ticker}-${row.timeframe}`} className="border-t border-slate-200">
                  <td className="px-1.5 py-1 font-mono text-slate-900">{row.ticker}</td>
                  <td className="px-1.5 py-1 text-slate-500">{row.timeframe}</td>
                  {versionsToShow.map((v) => {
                    const match = byVersion[v];
                    if (!match) {
                      return (
                        <td key={v} className="px-1.5 py-1 text-center text-slate-400">
                          —
                        </td>
                      );
                    }
                    const avgR = match.avg_r ?? 0;
                    const win = match.win_rate ?? 0;
                    const dd = match.max_dd ?? 0;
                    const trades = match.trades_total ?? 0;
                    return (
                      <td key={v} className="px-1.5 py-1 text-center align-top">
                        <div className="font-mono text-sm text-slate-900">
                          avgR {avgR.toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-500 whitespace-nowrap">
                          {trades}T · win {win.toFixed(1)}% · dd {dd.toFixed(1)}%
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-1.5 py-1 text-center align-top font-mono text-sm text-emerald-700">
                    {bestVersion ?? 'No valid engine'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};