'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface TradeRow {
  id: number;
  ticker: string;
  strategy: string;
  engine_key: string | null;
  engine_version: string | null;
  entry_timestamp: string;
  entry_price: number;
  exit_timestamp: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl_dollars: number | null;
  realized_pnl_r: number | null;
  size_shares: number;
  side: 'LONG' | 'SHORT' | null;
}

interface SignalSummary {
  id: string;
  symbol: string;
  timeframe: string | null;
  trading_style: string | null;
  engine_type: string | null;
  signal_type: string | null;
  confidence_score: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  created_at: string | null;
}

interface GroupRow {
  signal_id: string;
  signal: SignalSummary | null;
  trade_count: number;
  total_realized_pnl_dollars: number;
  total_realized_pnl_r: number;
  trades: TradeRow[];
}

interface ApiResponse {
  since: string;
  days: number;
  total_trades: number;
  total_signals: number;
  groups: GroupRow[];
}

export default function TradesBySignalPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/signal-trades?days=${days}`);
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const json = (await res.json()) as ApiResponse;
        setData(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [days]);

  const toggleExpanded = (signalId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(signalId)) {
        next.delete(signalId);
      } else {
        next.add(signalId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Trades grouped by signal</h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            One signal, many executions. This report groups live trades by <code>signal_id</code> so you can see exactly how
            each SWING / DAYTRADE signal was traded.
          </p>
        </div>
        <Link
          href="/admin/signals/live-decisions"
          className="text-sm text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
        >
          ← Back to Live Decisions
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Signal executions</CardTitle>
            <CardDescription>
              Showing trades with a non-null <code>signal_id</code> over the selected lookback window.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Window:</span>
            <div className="inline-flex rounded-md border bg-background">
              {[1, 3, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`px-3 py-1 text-xs border-l first:border-l-0 first:rounded-l-md last:rounded-r-md ${
                    days === d ? 'bg-emerald-500 text-white' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600">Error: {error}</p>
          ) : !data || data.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades found for the selected window.</p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {data.total_signals} signal(s), {data.total_trades} trade(s) since {new Date(data.since).toISOString()}.
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Trades</TableHead>
                    <TableHead>Total PnL</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.groups.map((group) => {
                    const s = group.signal;
                    const dir = (s?.signal_type || '').toLowerCase();
                    const isBuy = dir === 'buy' || dir === 'bullish';
                    const pnl = group.total_realized_pnl_dollars;
                    const pnlClass = pnl >= 0 ? 'text-emerald-600' : 'text-red-600';
                    const created = s?.created_at ? new Date(s.created_at).toISOString().replace('T', ' ').replace('Z', ' UTC') : '—';
                    const isExpanded = expanded.has(group.signal_id);

                    return (
                      <>
                        <TableRow key={group.signal_id}>
                          <TableCell className="text-xs font-mono">
                            {s?.symbol || '—'}
                            {s?.timeframe && (
                              <span className="ml-1 text-[10px] text-muted-foreground">{s.timeframe}</span>
                            )}
                            <div className="text-[10px] text-muted-foreground">signal_id={group.signal_id}</div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant="outline"
                              className={
                                dir === 'sell' || dir === 'bearish'
                                  ? 'border-red-400 text-red-700'
                                  : dir === 'buy' || dir === 'bullish'
                                  ? 'border-emerald-400 text-emerald-700'
                                  : 'border-slate-300 text-slate-700'
                              }
                            >
                              {s?.signal_type?.toUpperCase() || 'N/A'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s?.confidence_score != null ? `${Number(s.confidence_score).toFixed(1)}%` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{created}</TableCell>
                          <TableCell className="text-xs">
                            {group.trade_count} trade{group.trade_count === 1 ? '' : 's'}
                          </TableCell>
                          <TableCell className={`text-xs font-medium ${pnlClass}`}>
                            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)} ({group.total_realized_pnl_r.toFixed(2)}R)
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(group.signal_id)}
                              className="text-blue-600 hover:underline"
                            >
                              {isExpanded ? 'Hide trades' : 'Show trades'}
                            </button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${group.signal_id}-details`}>
                            <TableCell colSpan={7} className="bg-muted/40">
                              <div className="py-3">
                                <div className="text-xs font-semibold mb-2 text-muted-foreground">
                                  Trades for {s?.symbol || group.signal_id}
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="border-b text-muted-foreground">
                                        <th className="py-1 text-left">ID</th>
                                        <th className="py-1 text-left">Time</th>
                                        <th className="py-1 text-left">Side</th>
                                        <th className="py-1 text-left">Size</th>
                                        <th className="py-1 text-left">Entry</th>
                                        <th className="py-1 text-left">Exit</th>
                                        <th className="py-1 text-left">Reason</th>
                                        <th className="py-1 text-left">PnL</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.trades.map((t) => {
                                        const tradePnl = t.realized_pnl_dollars ?? 0;
                                        const tradeClass = tradePnl >= 0 ? 'text-emerald-600' : 'text-red-600';
                                        const ts = new Date(t.entry_timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC');
                                        return (
                                          <tr key={t.id} className="border-b last:border-0">
                                            <td className="py-1 font-mono">{t.id}</td>
                                            <td className="py-1">{ts}</td>
                                            <td className="py-1">{t.side ?? (isBuy ? 'LONG' : 'SHORT')}</td>
                                            <td className="py-1">{t.size_shares.toLocaleString()}</td>
                                            <td className="py-1">${t.entry_price.toFixed(4)}</td>
                                            <td className="py-1">
                                              {t.exit_price != null ? `$${t.exit_price.toFixed(4)}` : 'OPEN'}
                                            </td>
                                            <td className="py-1">{t.exit_reason || '—'}</td>
                                            <td className={`py-1 ${tradeClass}`}>
                                              {tradePnl >= 0 ? '+' : '-'}${Math.abs(tradePnl).toFixed(2)} (
                                              {(t.realized_pnl_r ?? 0).toFixed(2)}R)
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
