'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { createClient } from '@/lib/supabaseBrowser';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FocusTicker {
  trade_date: string;
  symbol: string;
  rank: number;
  confidence: number;
  min_confidence: number;
  engines: string[];
  primary_engine: string;
  metadata: Record<string, unknown> | null;
}

interface SignalData {
  signal_type: string;
  entry_price?: number;
  stop_loss?: number;
  take_profit_1?: number;
  take_profit_2?: number;
  reasoning?: string;
  created_at: string;
  correction_risk?: number;
  timeframe?: string;
  confidence_score?: number;
  confluence_score?: number;
  smc_analysis?: string;
  price_action_analysis?: string;
  volume_analysis?: string;
  market_structure?: string;
}

interface LivePosition {
  ticker: string;
  size_shares: number;
  side?: 'LONG' | 'SHORT';
}

type SortKey = 'symbol' | 'confidence';

export function FocusTickersCard() {
  const [tickers, setTickers] = useState<FocusTicker[]>([]);
  const [signals, setSignals] = useState<Map<string, SignalData>>(new Map());
  const [livePositions, setLivePositions] = useState<Map<string, LivePosition>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeDate, setTradeDate] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  useEffect(() => {
    async function loadFocus() {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);

      const baseQuery = supabase
        .from('daily_focus_tickers')
        .select('*')
        .eq('trade_date', today)
        .order('rank', { ascending: true })
        .limit(30);

      let { data, error } = await baseQuery;

      if (error) {
        setError(error.message);
        setTickers([]);
        setLoading(false);
        return;
      }

      // If no rows for today (e.g., pre-market not run yet), show the most recent set
      if (!data || data.length === 0) {
        const fallback = await supabase
          .from('daily_focus_tickers')
          .select('*')
          .order('trade_date', { ascending: false })
          .order('rank', { ascending: true })
          .limit(30);
        data = fallback.data || [];
        if (fallback.error) {
          setError(fallback.error.message);
          setTickers([]);
          setLoading(false);
          return;
        }
      }

      setTickers(data as FocusTicker[]);
      setTradeDate(data?.[0]?.trade_date ?? null);

      // Fetch latest signals for these tickers
      if (data && data.length > 0) {
        const symbols = data.map((t) => t.symbol);
        console.log('🔍 Fetching signals for symbols:', symbols);
        const [signalRes, positionsRes] = await Promise.all([
          supabase
            .from('ai_signals')
            .select('symbol, signal_type, entry_price, stop_loss, take_profit_1, take_profit_2, reasoning, created_at, correction_risk, timeframe, confidence_score')
            .in('symbol', symbols)
            .order('created_at', { ascending: false }),
          supabase
            .from('live_positions')
            .select('ticker, size_shares, side')
            .in('ticker', symbols)
            .gt('size_shares', 0)
        ]);

        console.log('📦 Signal response:', { error: signalRes.error, status: signalRes.status, count: signalRes.count, data: signalRes.data?.length });
        console.log('📦 Positions response:', { error: positionsRes.error, status: positionsRes.status, count: positionsRes.count, data: positionsRes.data?.length });
        
        if (signalRes.error) {
          console.error('❌ Signal fetch error:', JSON.stringify(signalRes.error, null, 2));
        }
        if (positionsRes.error) {
          console.error('❌ Positions fetch error:', JSON.stringify(positionsRes.error, null, 2));
        }

        if (signalRes.data) {
          console.log('📊 Fetched signals:', signalRes.data.length, 'signals');
          console.log('📊 Sample signal:', signalRes.data[0]);
          const signalMap = new Map<string, SignalData>();
          signalRes.data.forEach((signal) => {
            if (!signalMap.has(signal.symbol)) {
              signalMap.set(signal.symbol, signal);
            }
          });
          console.log('📊 Signal map size:', signalMap.size);
          console.log('📊 Signal map:', Array.from(signalMap.entries()));
          setSignals(signalMap);
        } else {
          console.log('❌ No signal data returned');
        }

        if (positionsRes.data) {
          const posMap = new Map<string, LivePosition>();
          positionsRes.data.forEach((p: LivePosition) => {
            posMap.set(p.ticker, p);
          });
          setLivePositions(posMap);
        }
      }

      setLoading(false);
    }

    loadFocus();
  }, []);

  const isToday = tradeDate === new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Daily Focus Tickers ({tickers.length} total)</CardTitle>
            <CardDescription>
              Top symbols (≥{process.env.NEXT_PUBLIC_FOCUS_MIN_CONFIDENCE ?? 60}% confidence) • Updated hourly
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="ml-4"
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (<CardContent className="space-y-4">
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton key={idx} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : tickers.length === 0 ? (
          <Alert>
            <AlertDescription>No focus tickers published yet. Check back after the pre-market sweep.</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              {!isToday && tradeDate && (
                <Alert className="flex-1">
                  <AlertDescription>
                    Showing the latest available focus list from {new Date(tradeDate).toLocaleDateString()}.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Sort by:</span>
                <div className="flex rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'px-3 py-1 text-xs',
                      sortKey === 'symbol' ? 'bg-white dark:bg-slate-800 font-medium shadow-inner' : 'text-slate-500',
                    )}
                    onClick={() => setSortKey('symbol')}
                  >
                    Name (A–Z)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'px-3 py-1 text-xs',
                      sortKey === 'confidence' ? 'bg-white dark:bg-slate-800 font-medium shadow-inner' : 'text-slate-500',
                    )}
                    onClick={() => setSortKey('confidence')}
                  >
                    Confidence
                  </Button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200 dark:border-slate-800">
                  <tr className="text-sm text-slate-600 dark:text-slate-400">
                    <th className="text-left py-3 px-4 font-semibold">Symbol</th>
                    <th className="text-left py-3 px-4 font-semibold">Signal</th>
                    <th className="text-left py-3 px-4 font-semibold">Status</th>
                    <th className="text-right py-3 px-4 font-semibold">Confidence</th>
                    <th className="text-right py-3 px-4 font-semibold">Risk</th>
                    <th className="text-right py-3 px-4 font-semibold">Entry</th>
                    <th className="text-right py-3 px-4 font-semibold">Stop</th>
                    <th className="text-right py-3 px-4 font-semibold">Target</th>
                    <th className="text-right py-3 px-4 font-semibold">Updated</th>
                    <th className="text-center py-3 px-4 font-semibold">Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {[...tickers]
                    .sort((a, b) => {
                      if (sortKey === 'symbol') {
                        return a.symbol.localeCompare(b.symbol);
                      }
                      if (b.confidence === a.confidence) {
                        return a.symbol.localeCompare(b.symbol);
                      }
                      return b.confidence - a.confidence;
                    })
                    .map((ticker) => {
                      const signal = signals.get(ticker.symbol);
                      const isExpanded = expandedSymbol === ticker.symbol;
                      const livePosition = livePositions.get(ticker.symbol);
                      const signalType = signal?.signal_type?.toUpperCase() ?? 'NEUTRAL';
                      const holdingWhileNeutral =
                        !!livePosition &&
                        (signalType === 'NEUTRAL' || signalType === 'FLAT' || signalType === 'NONE');
                      const displaySignal = holdingWhileNeutral
                        ? `NEUTRAL • HOLDING ${livePosition?.side === 'SHORT' ? 'SHORT' : 'LONG'}`
                        : signalType;
                      const signalBadgeClasses = cn(
                        'text-sm font-semibold px-2.5 py-0.5 border-0',
                        holdingWhileNeutral && livePosition?.side === 'LONG'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : holdingWhileNeutral && livePosition?.side === 'SHORT'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : signalType === 'BUY'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : signalType === 'SELL'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
                      );
                      return (
                        <React.Fragment key={`${ticker.trade_date}-${ticker.symbol}`}>
                          <tr
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                            onClick={() => setExpandedSymbol(isExpanded ? null : ticker.symbol)}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-base">{ticker.symbol}</span>
                                <ChevronDown className={cn(
                                  "h-4 w-4 text-slate-400 transition-transform",
                                  isExpanded && "transform rotate-180"
                                )} />
                              </div>
                            </td>
                          <td className="py-3 px-4">
                            <Badge className={signalBadgeClasses}>
                              {displaySignal}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            {livePosition ? (
                              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-sm font-semibold px-2.5 py-0.5 border-0">
                                LIVE {livePosition.side === 'SHORT' ? 'SHORT' : 'LONG'}
                              </Badge>
                            ) : (
                              <span className="text-sm text-slate-400">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-sm font-semibold">{ticker.confidence.toFixed(0)}%</td>
                          <td className="py-3 px-4 text-right text-sm font-semibold">
                            {signal?.correction_risk ? `${signal.correction_risk.toFixed(0)}%` : '-'}
                          </td>
                          <td className="py-3 px-4 text-right text-base font-semibold">
                            {signal?.entry_price ? `$${signal.entry_price.toFixed(2)}` : '-'}
                          </td>
                          <td className="py-3 px-4 text-right text-base font-semibold text-red-600 dark:text-red-400">
                            {signal?.stop_loss ? `$${signal.stop_loss.toFixed(2)}` : '-'}
                          </td>
                          <td className="py-3 px-4 text-right text-base font-semibold text-green-600 dark:text-green-400">
                            {signal?.take_profit_1 ? `$${signal.take_profit_1.toFixed(2)}` : '-'}
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-slate-500">
                            {signal?.created_at ? (
                              <span>
                                {(() => {
                                  const now = new Date();
                                  const created = new Date(signal.created_at);
                                  const diffMs = now.getTime() - created.getTime();
                                  const diffMins = Math.floor(diffMs / 60000);
                                  const diffHours = Math.floor(diffMins / 60);
                                  
                                  if (diffMins < 60) return `${diffMins}m ago`;
                                  if (diffHours < 24) return `${diffHours}h ago`;
                                  return `${Math.floor(diffHours / 24)}d ago`;
                                })()}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="text-xs text-slate-400">Click to expand</span>
                          </td>
                        </tr>
                        {isExpanded && signal && (
                          <tr key={`${ticker.trade_date}-${ticker.symbol}-expanded`}>
                            <td colSpan={10} className="px-4 py-4">
                              <div className="grid md:grid-cols-[220px,1fr] gap-6">
                                {/* PRICE LADDER */}
                                <div className="space-y-3">
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    Price Levels
                                  </div>
                                  <ol className="space-y-2 text-sm">
                                    {/* TP2 – informational only */}
                                    {signal.take_profit_2 && (
                                      <li className="flex items-center justify-between rounded-md border border-dashed border-emerald-300 bg-emerald-50/40 px-3 py-2 text-emerald-800">
                                        <div className="flex flex-col">
                                          <span className="text-xs font-semibold">TP2 (Extended)</span>
                                          <span className="text-[11px] text-emerald-900/80">
                                            TP2 is a projected extension and not the primary execution target.
                                          </span>
                                        </div>
                                        <span className="font-mono text-sm">${signal.take_profit_2.toFixed(2)}</span>
                                      </li>
                                    )}

                                    {/* TP1 */}
                                    {signal.take_profit_1 && (
                                      <li className="flex items-center justify-between rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]">
                                        <span className="text-xs font-semibold">TP1 (Primary target)</span>
                                        <span className="font-mono text-sm">${signal.take_profit_1.toFixed(2)}</span>
                                      </li>
                                    )}

                                    {/* ENTRY */}
                                    {signal.entry_price && (
                                      <li className="flex items-center justify-between rounded-md border border-sky-400 bg-sky-50 px-3 py-2 text-sky-900">
                                        <span className="text-xs font-semibold">ENTRY</span>
                                        <span className="font-mono text-sm">${signal.entry_price.toFixed(2)}</span>
                                      </li>
                                    )}

                                    {/* SL */}
                                    {signal.stop_loss && (
                                      <li className="flex items-center justify-between rounded-md border border-red-400 bg-red-50 px-3 py-2 text-red-900">
                                        <span className="text-xs font-semibold">SL (Stop-loss)</span>
                                        <span className="font-mono text-sm">${signal.stop_loss.toFixed(2)}</span>
                                      </li>
                                    )}
                                  </ol>
                                </div>

                                <div className="space-y-4">
                                  {/* AI TRADE PLAN BLOCK */}
                                  <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold">🧠 AI Trade Plan</span>
                                    </div>

                                    <div className="space-y-1 text-sm">
                                      {/* Risk */}
                                      <p>
                                        <span className="font-medium">Risk: </span>
                                        Defined by AI risk rules
                                      </p>

                                      {/* Stop-loss */}
                                      {signal.stop_loss && (
                                        <p>
                                          <span className="font-medium">Stop-loss: </span>
                                          Fixed at SL&nbsp;
                                          <span className="font-mono">${signal.stop_loss.toFixed(2)}</span>
                                        </p>
                                      )}

                                      {/* Primary target */}
                                      {signal.take_profit_1 && (
                                        <p>
                                          <span className="font-medium">Primary target: </span>
                                          TP1&nbsp;
                                          <span className="font-mono">${signal.take_profit_1.toFixed(2)}</span>
                                        </p>
                                      )}
                                    </div>

                                    <div className="grid gap-2 text-sm md:grid-cols-2">
                                      <div>
                                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                          Management rules
                                        </div>
                                        <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                                          <li>Secure profits at TP1</li>
                                          <li>Protect downside using the predefined stop-loss</li>
                                        </ul>
                                      </div>
                                      <div>
                                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                                          Discipline rules
                                        </div>
                                        <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                                          <li>Do not widen the stop-loss</li>
                                          <li>Do not add to losing positions</li>
                                        </ul>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Reasoning */}
                                  {signal.reasoning && (
                                    <div className="text-sm text-muted-foreground leading-relaxed">
                                      {signal.reasoning}
                                    </div>
                                  )}

                                  {/* Multi-Factor Analysis */}
                                  {(signal.smc_analysis || signal.price_action_analysis || signal.volume_analysis) && (
                                    <div className="border-t pt-3">
                                      <div className="text-xs font-bold text-muted-foreground uppercase mb-2">Multi-Factor Analysis</div>
                                      <div className="grid grid-cols-3 gap-4 text-sm">
                                        {signal.smc_analysis && (
                                          <div>
                                            <div className="font-semibold text-muted-foreground text-xs mb-1">📊 SMC</div>
                                            <div className="text-muted-foreground text-xs">{signal.smc_analysis}</div>
                                          </div>
                                        )}
                                        {signal.price_action_analysis && (
                                          <div>
                                            <div className="font-semibold text-muted-foreground text-xs mb-1">📈 Price Action</div>
                                            <div className="text-muted-foreground text-xs">{signal.price_action_analysis}</div>
                                          </div>
                                        )}
                                        {signal.volume_analysis && (
                                          <div>
                                            <div className="font-semibold text-muted-foreground text-xs mb-1">📊 Volume</div>
                                            <div className="text-muted-foreground text-xs">{signal.volume_analysis}</div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* FOOTER DISCLAIMER */}
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    ⚠️ Not financial advice. Trading involves risk. You are solely responsible for your trading decisions.
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>)}
    </Card>
  );
}
