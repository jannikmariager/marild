'use client';

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface SummaryCell {
  symbol_count: number;
  profitable_count: number;
  avg_avg_r: number;
  avg_win_rate: number;
}

interface SummaryRow {
  version: string;
  ticker: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
}

interface SummaryPayload {
  versions: string[];
  styles: ("DAYTRADER" | "SWING" | "INVESTOR")[];
  summary: Record<string, Record<string, SummaryCell>>;
  rows: SummaryRow[];
}

async function fetchSummary(): Promise<SummaryPayload> {
  const res = await fetch("/api/engines/summary");
  if (!res.ok) throw new Error("Failed to load engine summary");
  return res.json();
}

const STYLE_LABELS: Record<string, string> = {
  DAYTRADER: "Daytrader (intraday)",
  SWING: "Swing (multi-day)",
  INVESTOR: "Investor (long-term)",
};

function styleForTimeframe(tfRaw: string): "DAYTRADER" | "SWING" | "INVESTOR" {
  const tf = tfRaw.toLowerCase();
  if (["1m", "3m", "5m", "15m", "30m"].includes(tf)) return "DAYTRADER";
  if (["1h", "2h", "4h"].includes(tf)) return "SWING";
  return "INVESTOR";
}

export const EngineStyleSummary: React.FC = () => {
  const { data, isLoading, error } = useQuery<SummaryPayload>({
    queryKey: ["engine-style-summary"],
    queryFn: fetchSummary,
  });

  const [selectedStyle, setSelectedStyle] = useState<"DAYTRADER" | "SWING" | "INVESTOR">("DAYTRADER");

  const detailRows = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((row) => styleForTimeframe(row.timeframe) === selectedStyle)
      .sort((a, b) => (b.avg_r ?? 0) - (a.avg_r ?? 0));
  }, [data, selectedStyle]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading engine summary…</div>;
  if (error) return <div className="text-sm text-red-500">Error loading engine summary</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Engine vs Trading Style Overview</h2>
        <p className="text-xs text-muted-foreground max-w-2xl">
          This view is intentionally simple: rows are trading styles, columns are engine versions.
          Each cell shows how many symbols are profitable (avgR &gt; 0) out of all symbols for that
          style+engine, plus the average R-multiple and win rate across those symbols.
        </p>
      </div>

      {/* STYLE × VERSION summary table */}
      <div className="overflow-auto border rounded-md">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/60">
              <th className="px-3 py-2 text-left">Trading Style</th>
              {data.versions.map((v) => (
                <th key={v} className="px-3 py-2 text-center">{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.styles.map((style) => (
              <tr key={style} className="border-t border-border">
                <td className="px-3 py-2 text-left font-medium align-top">
                  {STYLE_LABELS[style] ?? style}
                </td>
                {data.versions.map((v) => {
                  const cell = data.summary[style]?.[v];
                  if (!cell) {
                    return (
                      <td key={v} className="px-3 py-2 text-center text-muted-foreground">—</td>
                    );
                  }
                  return (
                    <td key={v} className="px-3 py-2 text-center align-top">
                      <div className="font-mono text-xs">
                        {cell.profitable_count}/{cell.symbol_count}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        avgR {cell.avg_avg_r.toFixed(2)} · win {cell.avg_win_rate.toFixed(1)}%
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail list for selected style */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Detailed results by ticker</h3>
            <p className="text-xs text-muted-foreground">
              Showing per-ticker stats for <span className="font-mono">{STYLE_LABELS[selectedStyle]}</span>
              . Compare engines by looking across the columns.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Style:</span>
            <select
              value={selectedStyle}
              onChange={(e) => setSelectedStyle(e.target.value as any)}
              className="border border-border bg-background px-2 py-1 rounded-md text-xs"
            >
              {data.styles.map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-auto border rounded-md max-h-[480px]">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/60">
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-left">Timeframe</th>
                {data.versions.map((v) => (
                  <th key={v} className="px-2 py-1 text-center">{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row) => (
                <tr key={`${row.ticker}-${row.timeframe}`} className="border-t border-border">
                  <td className="px-2 py-1 font-mono">{row.ticker}</td>
                  <td className="px-2 py-1 text-muted-foreground">{row.timeframe}</td>
                  {data.versions.map((v) => {
                    // find the row for this ticker+timeframe+version
                    const match = data.rows.find(
                      (r) =>
                        r.version === v &&
                        r.ticker === row.ticker &&
                        r.timeframe === row.timeframe,
                    );
                    if (!match) {
                      return (
                        <td key={v} className="px-2 py-1 text-center text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={v} className="px-2 py-1 text-center align-top">
                        <div className="font-mono text-xs">
                          {match.avg_r != null ? match.avg_r.toFixed(2) : "0.00"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          win {match.win_rate != null ? match.win_rate.toFixed(1) : "0.0"}% ·
                          dd {match.max_dd != null ? match.max_dd.toFixed(1) : "0.0"}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
