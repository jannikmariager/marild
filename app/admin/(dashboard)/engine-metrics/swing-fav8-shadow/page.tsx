'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

export default function SwingFav8ShadowPage() {
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
          (m: EngineMetric) => m.run_mode === 'SHADOW' && m.engine_version === 'SWING_FAV8_SHADOW'
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

  if (loading) {
    return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Engine Metrics</h1><p className="text-muted-foreground mt-2">Loading...</p></div></div>;
  }

  if (error || !engine) {
    return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Engine Metrics</h1><p className="text-red-600 mt-2">Error: {error}</p></div></div>;
  }

  const recentTrades = (engine.recent_trades || []).slice(0, 25);

  const tradesByDay: { [key: string]: EngineTrade[] } = {};
  allTrades.forEach(trade => {
    if (trade.exit_timestamp) {
      const day = new Date(trade.exit_timestamp).toLocaleDateString();
      if (!tradesByDay[day]) tradesByDay[day] = [];
      tradesByDay[day].push(trade);
    }
  });

  const last7Days = Object.keys(tradesByDay)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
    .slice(0, 7);

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
                  {trade.exit_timestamp ? new Date(trade.exit_timestamp).toLocaleDateString() : '—'}
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
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">SWING_FAV8_SHADOW</h1>
          <Badge className="bg-purple-100 text-purple-700 border-purple-300">SHADOW</Badge>
        </div>
        <p className="text-muted-foreground mt-2">Fixed 8-ticker swing shadow engine (Dec 12–15 relaxed config, $100k virtual equity)</p>
      </div>

      {engine.engine_params && (engine.engine_params.promoted_ticker_count || engine.engine_params.promoted_tickers) && (
        <Card>
          <CardHeader>
            <CardTitle>Configuration Parameters</CardTitle>
            <CardDescription>Promotion-gated fixed universe</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-4">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Universe</h3>
                <div className="text-sm">
                  <span className="font-medium">{engine.engine_params.promoted_tickers || 'AVGO, AMD, AAPL, NVDA, COIN, NFLX, MARA, TSLA'}</span>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">Starting Equity</h3>
                <div className="text-sm font-medium">$100,000</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Performance Snapshot</CardTitle>
          <CardDescription>Shadow account metrics</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Current Equity</div>
            <div className="text-2xl font-semibold">${engine.current_equity.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Net Return</div>
            <div className="text-2xl font-semibold">{engine.net_return.toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className="text-2xl font-semibold">{engine.win_rate.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Max Drawdown</div>
            <div className="text-2xl font-semibold">{engine.max_drawdown.toFixed(2)}%</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
          <CardDescription>Last 25 closed shadow trades</CardDescription>
        </CardHeader>
        <CardContent>{recentTrades.length ? <TradesTable trades={recentTrades} /> : <p className="text-sm text-muted-foreground">No trades yet.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last 7 Days (grouped)</CardTitle>
          <CardDescription>Expandable daily trade breakdown</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {last7Days.length === 0 && <p className="text-sm text-muted-foreground">No trades yet.</p>}
          {last7Days.map(day => {
            const trades = tradesByDay[day] || [];
            const pnl = trades.reduce((sum, t) => sum + Number(t.realized_pnl_dollars ?? 0), 0);
            const isWinner = pnl >= 0;
            const expanded = expandedDays.has(day);
            return (
              <div key={day} className="border rounded-md">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => toggleDay(day)}
                >
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    <span className="font-medium">{day}</span>
                  </div>
                  <span className={`font-semibold ${isWinner ? 'text-green-700' : 'text-red-700'}`}>
                    {isWinner ? '+' : ''}{pnl.toFixed(2)}
                  </span>
                </button>
                {expanded && (
                  <div className="px-4 pb-4">
                    <TradesTable trades={trades} />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
