'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { NyTimeBadge } from '@/components/admin/NyTimeBadge';
import { formatNyDate, getNyDayKey } from '@/lib/datetime';

interface EngineTrade {
  ticker: string | null;
  side: 'LONG' | 'SHORT' | null;
  entry_price: number | null;
  exit_price: number | null;
  entry_timestamp: string | null;
  exit_timestamp: string | null;
  realized_pnl_dollars: number | null;
  realized_pnl_r: number | null;
}

interface EngineMetric {
  engine_version: string
  engine_key: string
  run_mode: 'PRIMARY' | 'SHADOW'
  is_enabled: boolean
  total_trades: number
  winners: number
  losers: number
  win_rate: number
  total_pnl: number
  avg_r: number
  max_drawdown: number
  current_equity: number
  net_return: number
  recent_trades?: EngineTrade[]
  display_label?: string
  engine_params?: {
    promoted_tickers?: string
    promoted_ticker_count?: number
    strategy_type?: string
    tp_activation?: string
    trailing_distance?: string
    time_exit?: string
    overnight_hygiene?: string
    hygiene_actions?: string
  }
}

export default function SwingV2RobustPage() {
  const [engine, setEngine] = useState<EngineMetric | null>(null);
  const [allTrades, setAllTrades] = useState<EngineTrade[]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/admin/engine-metrics');
        if (!response.ok) throw new Error('Failed to fetch metrics');
        const data = await response.json();
        
        const shadowEngines = (data.metrics || []).filter(
          (m: EngineMetric) => m.run_mode === 'SHADOW' && m.engine_version === 'SWING_V2_ROBUST'
        );
        
        if (shadowEngines.length === 0) {
          throw new Error('Engine not found');
        }
        
        setEngine(shadowEngines[0]);
        setAllTrades(shadowEngines[0].recent_trades || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const recentTrades = (engine?.recent_trades || []).slice(0, 25);

  type TradeGroup = { key: string; label: string; trades: EngineTrade[]; timestamp: number };
  const groupedTrades = useMemo<TradeGroup[]>(() => {
    const map = new Map<string, TradeGroup>();
    for (const trade of allTrades) {
      if (!trade.exit_timestamp) continue;
      const key = getNyDayKey(trade.exit_timestamp);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: formatNyDate(trade.exit_timestamp),
          trades: [],
          timestamp: new Date(trade.exit_timestamp).getTime(),
        });
      }
      map.get(key)!.trades.push(trade);
    }
    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [allTrades]);

  if (loading) {
    return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Engine Metrics</h1><p className="text-muted-foreground mt-2">Loading...</p></div></div>;
  }

  if (error || !engine) {
    return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Engine Metrics</h1><p className="text-red-600 mt-2">Error: {error}</p></div></div>;
  }

  const last7Days = groupedTrades.slice(0, 7);

  const toggleDay = (day: string) => {
    const newExpanded = new Set(expandedDays);
    newExpanded.has(day) ? newExpanded.delete(day) : newExpanded.add(day);
    setExpandedDays(newExpanded);
  };

  const TradesTable = ({ trades }: { trades: EngineTrade[] }) => {
    const sorted = [...trades].sort((a, b) => 
      Number(b.realized_pnl_dollars ?? 0) - Number(a.realized_pnl_dollars ?? 0)
    );

    return (
      <Table className="text-sm">
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-16">Ticker</TableHead>
            <TableHead className="w-12">Side</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">Exit</TableHead>
            <TableHead className="text-right">PnL $</TableHead>
            <TableHead className="text-right">R</TableHead>
            <TableHead className="text-xs">Closed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((trade, idx) => {
            const pnl = Number(trade.realized_pnl_dollars ?? 0);
            const isWinner = pnl >= 0;
            return (
              <TableRow key={idx} className={isWinner ? 'bg-green-50/30' : 'bg-red-50/30'}>
                <TableCell className="font-semibold">{trade.ticker || '—'}</TableCell>
                <TableCell>
                  <Badge variant={trade.side === 'LONG' ? 'default' : 'secondary'} className="text-xs">
                    {trade.side || '—'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">${trade.entry_price?.toFixed(2) ?? '—'}</TableCell>
                <TableCell className="text-right font-mono text-xs">${trade.exit_price?.toFixed(2) ?? '—'}</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${isWinner ? 'text-green-700' : 'text-red-700'}`}>
                  {isWinner ? '+' : ''}{pnl.toFixed(2)}
                </TableCell>
                <TableCell className={`text-right font-mono font-semibold ${Number(trade.realized_pnl_r) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {Number(trade.realized_pnl_r ?? 0).toFixed(2)}R
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {trade.exit_timestamp ? formatNyDate(trade.exit_timestamp) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">SWING_V2_ROBUST</h1>
            <Badge className="bg-purple-100 text-purple-700 border-purple-300">SHADOW</Badge>
          </div>
          <p className="text-muted-foreground mt-2">
            Robust swing trading strategy with overnight capital hygiene and early profit protection
          </p>
        </div>
        <NyTimeBadge />
      </div>

      {/* Engine Parameters */}
      {engine.engine_params && (engine.engine_params.tp_activation || engine.engine_params.strategy_type) && (
        <Card>
          <CardHeader>
            <CardTitle>Configuration Parameters</CardTitle>
            <CardDescription>Exit logic and trading settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-4">
              {/* Strategy Type */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Strategy</h3>
                <div className="text-sm">
                  <span className="font-medium">{engine.engine_params.strategy_type}</span>
                </div>
              </div>

              {/* Exit Logic */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Exit Logic</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TP</span>
                    <span className="font-medium">{engine.engine_params.tp_activation}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trailing</span>
                    <span className="font-medium">{engine.engine_params.trailing_distance}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time Exit</span>
                    <span className="font-medium">{engine.engine_params.time_exit}</span>
                  </div>
                </div>
              </div>

              {/* Universe */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Universe</h3>
                <div className="text-xs">
                  <div className="text-muted-foreground mb-1">Tickers ({engine.engine_params.promoted_ticker_count})</div>
                  <p className="bg-muted/50 p-1 rounded font-mono text-xs break-words">
                    {engine.engine_params.promoted_tickers}
                  </p>
                </div>
              </div>

              {/* Overnight Hygiene */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">🌙 Hygiene</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-medium text-emerald-600">{engine.engine_params.overnight_hygiene}</span>
                  </div>
                  <p className="text-muted-foreground mt-1">{engine.engine_params.hygiene_actions}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{engine.win_rate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">{engine.winners}W / {engine.losers}L</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Avg R</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${engine.avg_r >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {engine.avg_r.toFixed(2)}R
            </div>
            <p className="text-xs text-muted-foreground">{engine.total_trades} trades</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${engine.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${engine.total_pnl.toFixed(0)}
            </div>
            <p className="text-xs text-muted-foreground">{engine.net_return.toFixed(2)}% return</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Current Equity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${engine.current_equity.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Max DD: -{engine.max_drawdown.toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Last 25 Trades */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades (Last 25)</CardTitle>
          <CardDescription>Most recent closed trades on this engine</CardDescription>
        </CardHeader>
        <CardContent>
          <TradesTable trades={recentTrades} />
        </CardContent>
      </Card>

      {/* Last 7 Days Expandable */}
      <Card>
        <CardHeader>
          <CardTitle>Last 7 Days</CardTitle>
          <CardDescription>Daily breakdown of trades</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {last7Days.length === 0 ? (
            <p className="text-muted-foreground">No trades in last 7 days</p>
          ) : (
            last7Days.map(group => {
              const dayTrades = group.trades;
              const dayWins = dayTrades.filter(t => Number(t.realized_pnl_dollars ?? 0) >= 0).length;
              const dayPnL = dayTrades.reduce((sum, t) => sum + Number(t.realized_pnl_dollars ?? 0), 0);
              const isExpanded = expandedDays.has(group.key);

              return (
                <div key={group.key}>
                  <button
                    onClick={() => toggleDay(group.key)}
                    className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span className="font-medium">{group.label}</span>
                      <span className="text-muted-foreground">{dayTrades.length} trades</span>
                      <span className={dayPnL >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                        {dayPnL >= 0 ? '+' : ''} ${dayPnL.toFixed(2)}
                      </span>
                      <Badge variant="outline" className="text-xs">{dayWins}W / {dayTrades.length - dayWins}L</Badge>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="mt-2 pl-4 border-l-2 border-muted">
                      <TradesTable trades={dayTrades} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* All Recent Trades by Date */}
      <Card>
        <CardHeader>
          <CardTitle>All Recent Trades</CardTitle>
          <CardDescription>Complete trade history (newest first)</CardDescription>
        </CardHeader>
        <CardContent>
          {allTrades.length === 0 ? (
            <p className="text-muted-foreground">No trades yet</p>
          ) : (
            <div className="space-y-6">
              {groupedTrades.map(({ key, label, trades }) => {
                const sortedTrades = [...trades].sort((a, b) => {
                  const aTime = a.exit_timestamp ? new Date(a.exit_timestamp).getTime() : 0
                  const bTime = b.exit_timestamp ? new Date(b.exit_timestamp).getTime() : 0
                  return bTime - aTime
                })
                const dayWins = sortedTrades.filter(t => Number(t.realized_pnl_dollars ?? 0) >= 0).length
                const dayPnL = sortedTrades.reduce((sum, t) => sum + Number(t.realized_pnl_dollars ?? 0), 0)
                const dayAvgR = sortedTrades.length > 0
                  ? sortedTrades.reduce((sum, t) => sum + Number(t.realized_pnl_r ?? 0), 0) / sortedTrades.length
                  : 0

                return (
                  <div key={key} className="border-b last:border-b-0 pb-4 last:pb-0">
                    <div className="flex items-center justify-between mb-4 py-2">
                      <h3 className="font-semibold text-sm">{label}</h3>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-muted-foreground">{sortedTrades.length} trades</span>
                        <span className={dayPnL >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {dayPnL >= 0 ? '+' : ''} ${dayPnL.toFixed(2)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {dayWins}W / {sortedTrades.length - dayWins}L
                        </Badge>
                        <span className={dayAvgR >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                          Avg: {dayAvgR.toFixed(2)}R
                        </span>
                      </div>
                    </div>
                    <TradesTable trades={sortedTrades} />
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
