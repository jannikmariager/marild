'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, Clock, ExternalLink, Activity, User, ChevronDown, ChevronUp } from 'lucide-react';
import { SignalPublishingFaqDialog, SignalPublishingFaqMicrocopy } from '@/components/faq/signal-publishing-faq-dialog';
import { useSignalsStore } from '@/lib/stores/signals-store';
import { createClient } from '@/lib/supabaseBrowser';
import { formatTimeAgo } from '@/lib/formatting';

interface Signal {
  id: string;
  symbol: string;
  timeframe: string;
  signal_type: 'buy' | 'sell' | 'neutral';
  confidence_score: number;
  correction_risk: number;
  created_at: string;
  updated_at: string;
  is_manual_request: boolean;
  source?: 'user_requested' | 'performance_engine';
  status?: 'active' | 'expired' | 'tp_hit' | 'sl_hit' | 'timed_out';
  performance_trade_id?: string;
  performance_traded?: boolean;
  performance_trade_status?: string | null;
  trade_gate_allowed?: boolean;
  trade_gate_reason?: string | null;
  blocked_until_et?: string | null;
  // Discord delivery tracking
  discord_sent_at?: string | null;
  discord_channel?: string | null;
  discord_daily_rank?: number | null;
  discord_delivery_status?: 'sent' | 'skipped' | 'error' | null;
  discord_skip_reason?: string | null;
  discord_error?: string | null;
  freshnessMinutes?: number;
  volatility_state?: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  volatility_percentile?: number | null;
  volatility_explanation?: string | null;
}

type SortKey = 'updated_at' | 'confidence_score' | 'correction_risk' | 'symbol' | 'timeframe';

type SortDir = 'asc' | 'desc';
const VISIBLE_SIGNAL_STATES = ['app_only', 'app_discord', 'app_discord_push'] as const;
const VISIBLE_SIGNAL_STATUSES = ['active', 'watchlist', 'filled', 'tp_hit', 'sl_hit', 'timed_out'] as const;

export function SignalsTable() {
  const { filters } = useSignalsStore();
  const router = useRouter();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveSignals, setArchiveSignals] = useState<Signal[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const itemsPerPage = 50;
  const [sortBy, setSortBy] = useState<SortKey>('updated_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const HISTORY_WINDOW_HOURS = 72;
  const MAX_FETCH = 500;

  const dedupeSignals = useCallback((list: Signal[]) => {
    const seen = new Set<string>();
    const deduped: Signal[] = [];
    for (const signal of list) {
      const key = `${signal.symbol}-${signal.timeframe}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(signal);
    }
    return deduped;
  }, []);

  // Auto-expand when symbol filter is applied
  useEffect(() => {
    if (filters.symbol) {
      setIsCollapsed(false);
    }
  }, [filters.symbol]);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Base timeframe: only load signals from the last 72 hours
    const historyWindowStart = new Date(Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('ai_signals')
      .select('*')
      .gte('updated_at', historyWindowStart)
      .in('status', VISIBLE_SIGNAL_STATUSES)
      .limit(MAX_FETCH);

    const visibilityFilter = `visibility_state.in.(${VISIBLE_SIGNAL_STATES.join(',')})`;
    query = query.or(`visibility_state.is.null,${visibilityFilter}`);

    // Apply sort
    const applySort = (q: any): any => {
      // Always secondary sort by updated_at desc to keep newest first within any bucket
      if (sortBy === 'updated_at') {
        return q
          .order('updated_at', { ascending: sortDir === 'asc' })
          .order('confidence_score', { ascending: false });
      }
      if (sortBy === 'confidence_score') {
        return q
          .order('confidence_score', { ascending: sortDir === 'asc' })
          .order('updated_at', { ascending: false });
      }
      if (sortBy === 'correction_risk') {
        return q
          .order('correction_risk', { ascending: sortDir === 'asc' })
          .order('updated_at', { ascending: false });
      }
      if (sortBy === 'symbol') {
        return q
          .order('symbol', { ascending: sortDir === 'asc' })
          .order('updated_at', { ascending: false });
      }
      if (sortBy === 'timeframe') {
        return q
          .order('timeframe', { ascending: sortDir === 'asc' })
          .order('updated_at', { ascending: false });
      }
      return q.order('updated_at', { ascending: false });
    };

    query = applySort(query);

    // Apply filters to main query
    if (filters.symbol) {
      query = query.eq('symbol', filters.symbol);
    }
    if (filters.signalType) {
      query = query.eq('signal_type', filters.signalType);
    }
    // Timeframe filter removed from UI; keep backend query unfiltered by timeframe.
    if (filters.freshOnly !== undefined) {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      if (filters.freshOnly) {
        query = query.gte('updated_at', fourHoursAgo);
      } else {
        query = query.lt('updated_at', fourHoursAgo);
      }
    }
    if (filters.source) {
      query = query.eq('source', filters.source);
    }
    if (filters.onlyTradedByAi) {
      // Filter to signals that have an actual linked model-portfolio trade.
      query = query.not('performance_trade_id', 'is', null);
    }
    const { data, error } = await query;

    if (error) {
      console.error('Error fetching signals:', error);
    } else {
      const now = Date.now();
      const normalized = (data || []).map((signal) => ({
        ...signal,
        freshnessMinutes: (now - new Date(signal.updated_at).getTime()) / 60000,
      }));
      const deduped = dedupeSignals(normalized);
      setSignals(deduped);
      setTotalCount(deduped.length);
    }

    setLoading(false);
  }, [dedupeSignals, filters, sortBy, sortDir]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sortBy, sortDir]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);
  useEffect(() => {
    const computedTotalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));
    if (currentPage > computedTotalPages) {
      setCurrentPage(computedTotalPages);
    }
  }, [currentPage, totalCount, itemsPerPage]);

  const fetchArchive = useCallback(async () => {
    if (archiveLoading || (showArchive && archiveSignals.length > 0)) return;
    setArchiveLoading(true);
    const supabase = createClient();
    const seventyTwoHoursAgo = new Date(Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ai_signals')
      .select('*')
      .in('status', VISIBLE_SIGNAL_STATUSES)
      .lt('updated_at', seventyTwoHoursAgo)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Error fetching archived signals:', error);
    } else {
      const now = Date.now();
      const normalized = (data || []).map((signal) => ({
        ...signal,
        freshnessMinutes: (now - new Date(signal.updated_at).getTime()) / 60000,
      }));
      setArchiveSignals(normalized);
    }

    setArchiveLoading(false);
  }, [archiveLoading, showArchive, archiveSignals.length]);

  const totalPages = totalCount === 0 ? 1 : Math.ceil(totalCount / itemsPerPage);
  const startItemIndex = (currentPage - 1) * itemsPerPage;
  const endItemIndex = startItemIndex + itemsPerPage;
  const startItem = totalCount === 0 ? 0 : startItemIndex + 1;
  const endItem = totalCount === 0 ? 0 : Math.min(endItemIndex, totalCount);
  const paginatedSignals = signals.slice(startItemIndex, endItemIndex);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const handleViewDetails = (signal: Signal) => {
    router.push(`/tradesignals/${signal.id}`);
  };

  const getSignalIcon = (type: string) => {
    switch (type) {
      case 'buy':
        return <TrendingUp className="h-4 w-4" />;
      case 'sell':
        return <TrendingDown className="h-4 w-4" />;
      default:
        return <Minus className="h-4 w-4" />;
    }
  };

  const getSignalBadge = (type: string) => {
    switch (type) {
      case 'buy':
        return <Badge variant="default">{getSignalIcon(type)} BUY</Badge>;
      case 'sell':
        return <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20">{getSignalIcon(type)} SELL</Badge>;
      default:
        return <Badge variant="secondary">{getSignalIcon(type)} NEUTRAL</Badge>;
    }
  };
  const getVolatilityBadge = (signal: Signal) => {
    const state = signal.volatility_state ?? 'NORMAL';
    const percentile = signal.volatility_percentile ?? null;
    const explanation = signal.volatility_explanation ?? 'Volatility shows how much price is moving. Signal shows directional edge.';
    let className = 'bg-slate-50 text-slate-700 border-slate-200';
    if (state === 'LOW') className = 'bg-sky-50 text-sky-700 border-sky-200';
    if (state === 'HIGH') className = 'bg-amber-100 text-amber-800 border-amber-300';
    if (state === 'EXTREME') className = 'bg-red-100 text-red-800 border-red-300';
    return (
      <Badge
        variant="outline"
        className={`${className} text-xs`}
        title={`${explanation} Volatility shows how much price is moving. Signal shows directional edge.`}
      >
        {state}{percentile != null ? ` · P${percentile}` : ''}
      </Badge>
    );
  };

  const getFreshnessBadge = (freshnessMinutes?: number) => {
    if (typeof freshnessMinutes !== 'number') {
      return <Badge variant="outline" className="text-gray-500">Expired</Badge>;
    }
    const ageMinutes = freshnessMinutes;
    if (ageMinutes < 60) {
      return (
        <Badge
          variant="outline"
          className="border-emerald-300 text-emerald-800"
        >
          Fresh
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-gray-500">Expired</Badge>;
  };


  const getSourceBadge = (signal: Signal) => {
    const { source, status, performance_trade_id, confidence_score } = signal;

    if (source === 'performance_engine') {
      // "AI TRADED" is only shown when there is an actual linked model-portfolio trade.
      const isAiTraded = !!performance_trade_id;
      // "AI TRADE PLAN" is only shown for signals with confidence >= 60%
      const showTradePlan = !isAiTraded && confidence_score >= 60;
      const label = isAiTraded ? 'AI TRADED' : 'AI TRADE PLAN';

      return (
        <div className="flex flex-col gap-1">
          {(isAiTraded || showTradePlan) && (
            <Badge
              variant="outline"
              className={
                isAiTraded
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300 text-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-300 text-xs'
              }
            >
              <Activity className="w-3 h-3 mr-1" />
              {label}
            </Badge>
          )}
          {status && status !== 'active' && getResultBadge(status)}
        </div>
      );
    }

    return (
      <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs">
        <User className="w-3 h-3 mr-1" />
        USER SIGNAL
      </Badge>
    );
  };
  const getPlanStatusBadge = (signal: Signal) => {
    if (signal.performance_traded) {
      const tradeStatus = signal.performance_trade_status?.toUpperCase() || 'OPEN';
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 text-xs">
          Traded • {tradeStatus}
        </Badge>
      );
    }
    if (signal.trade_gate_allowed === false) {
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/20 text-xs">
          Gate {signal.trade_gate_reason || 'Hold'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-xs">
        Queued
      </Badge>
    );
  };

  const getResultBadge = (status: string) => {
    switch (status) {
      case 'tp_hit':
        return <Badge className="bg-emerald-100 text-emerald-800 text-xs">TP Hit ✓</Badge>;
      case 'sl_hit':
        return <Badge className="bg-red-100 text-red-700 text-xs">SL Hit ✗</Badge>;
      case 'timed_out':
        return <Badge className="bg-orange-100 text-orange-700 text-xs">Timed Out ⏱</Badge>;
      default:
        return null;
    }
  };


  const getDiscordBadge = (signal: Signal) => {
    if (signal.discord_sent_at) {
      return (
        <Badge
          variant="outline"
          className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 text-xs"
        >
          Sent{signal.discord_channel ? ` • ${signal.discord_channel}` : ''}
          {signal.discord_daily_rank ? ` #${signal.discord_daily_rank}` : ''}
        </Badge>
      );
    }

    const status = signal.discord_delivery_status?.toLowerCase();
    const reason = signal.discord_skip_reason || signal.discord_error || '';

    if (status === 'error') {
      return (
        <Badge
          variant="outline"
          className="bg-red-500/10 text-red-700 border-red-500/20 text-xs"
          title={reason || undefined}
        >
          Error
        </Badge>
      );
    }

    if (status === 'skipped') {
      return (
        <Badge
          variant="outline"
          className="bg-amber-500/10 text-amber-700 border-amber-500/20 text-xs"
          title={reason || undefined}
        >
          Skipped
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-xs">
        Not posted
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">Loading signals...</p>
        </CardContent>
      </Card>
    );
  }

  if (signals.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            No signals found in the last 72 hours. Try adjusting your filters or open the archive below to view older signals.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span>Signals ({totalCount.toLocaleString()} total)</span>
              <SignalPublishingFaqDialog />
            </CardTitle>
            <div className="flex items-center gap-4">
              {totalCount > 0 && (
                <span className="text-sm text-gray-500">
                  Showing {startItem}-{endItem} of {totalCount.toLocaleString()}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCollapsed(!isCollapsed)}
              >
                {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        {!isCollapsed && (<CardContent>
          <SignalPublishingFaqMicrocopy className="mb-4" />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left">
                  <th
                    className="pb-3 font-medium cursor-pointer select-none"
                    onClick={() => toggleSort('symbol')}
                  >
                    Symbol
                  </th>
                  <th
                    className="pb-3 font-medium cursor-pointer select-none"
                    onClick={() => toggleSort('timeframe')}
                  >
                    Timeframe
                  </th>
                  <th className="pb-3 font-medium">Signal</th>
                  <th className="pb-3 font-medium" title="Volatility shows how much price is moving. Signal shows directional edge.">
                    Volatility
                  </th>
                  <th
                    className="pb-3 font-medium cursor-pointer select-none"
                    onClick={() => toggleSort('confidence_score')}
                  >
                    Confidence
                  </th>
                  <th
                    className="pb-3 font-medium cursor-pointer select-none"
                    onClick={() => toggleSort('correction_risk')}
                  >
                    Risk
                  </th>
                  <th className="pb-3 font-medium">Status</th>
                  <th
                    className="pb-3 font-medium cursor-pointer select-none"
                    onClick={() => toggleSort('updated_at')}
                  >
                    Updated
                  </th>
                  <th className="pb-3 font-medium">Source</th>
                  <th className="pb-3 font-medium">Plan</th>
                  <th className="pb-3 font-medium">Discord</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedSignals.map((signal) => (
                  <tr key={signal.id} className="border-b last:border-0">
                    <td className="py-4">
                      <span className="text-[13px] font-bold text-foreground">{signal.symbol}</span>
                    </td>
                    <td className="py-4 text-sm">{signal.timeframe}</td>
                    <td className="py-4">{getSignalBadge(signal.signal_type)}</td>
                    <td className="py-4">{getVolatilityBadge(signal)}</td>
                    <td className="py-4 text-sm">{signal.confidence_score}%</td>
                    <td className="py-4 text-sm">{signal.correction_risk}%</td>
                    <td className="py-4">{getFreshnessBadge(signal.freshnessMinutes)}</td>
                    <td className="py-4 text-sm text-muted-foreground">
                      <div className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatTimeAgo(signal.updated_at)}</span>
                      </div>
                    </td>
                    <td className="py-4 text-sm">
                      {getSourceBadge(signal)}
                    </td>
                    <td className="py-4">{getPlanStatusBadge(signal)}</td>
                    <td className="py-4">{getDiscordBadge(signal)}</td>
                    <td className="py-4">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleViewDetails(signal)}
                        title="View details"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                ← Previous
              </Button>

              <div className="flex items-center gap-2">
                {/* First page */}
                {currentPage > 3 && (
                  <>
                    <Button
                      variant={currentPage === 1 ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                    >
                      1
                    </Button>
                    {currentPage > 4 && <span className="text-gray-400">...</span>}
                  </>
                )}

                {/* Pages around current */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(page => page >= currentPage - 2 && page <= currentPage + 2)
                  .map(page => (
                    <Button
                      key={page}
                      variant={currentPage === page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className={currentPage === page ? 'bg-[#0AAE84] hover:bg-[#0AAE84]/90' : ''}
                    >
                      {page}
                    </Button>
                  ))}

                {/* Last page */}
                {currentPage < totalPages - 2 && (
                  <>
                    {currentPage < totalPages - 3 && <span className="text-gray-400">...</span>}
                    <Button
                      variant={currentPage === totalPages ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                    >
                      {totalPages}
                    </Button>
                  </>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next →
              </Button>
            </div>
          )}
        </CardContent>)}
      </Card>

      {/* Archive section */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Archive (older than 72 hours)</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!showArchive && archiveSignals.length === 0) {
                  await fetchArchive();
                }
                setShowArchive((prev) => !prev);
              }}
            >
              {showArchive ? 'Hide archive' : 'Show archive'}
            </Button>
          </div>
        </CardHeader>
        {showArchive && (
          <CardContent>
            {archiveLoading ? (
              <p className="text-center text-muted-foreground">Loading archived signals...</p>
            ) : archiveSignals.length === 0 ? (
              <p className="text-center text-muted-foreground">No archived signals found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Symbol</th>
                      <th className="pb-2 font-medium">Timeframe</th>
                      <th className="pb-2 font-medium">Signal</th>
                      <th className="pb-2 font-medium">Confidence</th>
                      <th className="pb-2 font-medium">Risk</th>
                      <th className="pb-2 font-medium">Updated</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {archiveSignals.map((signal) => (
                      <tr key={signal.id} className="border-b last:border-0">
                        <td className="py-3">{signal.symbol}</td>
                        <td className="py-3">{signal.timeframe}</td>
                        <td className="py-3">{getSignalBadge(signal.signal_type)}</td>
                        <td className="py-3">{signal.confidence_score}%</td>
                        <td className="py-3">{signal.correction_risk}%</td>
                        <td className="py-3 text-sm text-muted-foreground">{formatTimeAgo(signal.updated_at)}</td>
                        <td className="py-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleViewDetails(signal)}
                            title="View details"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

    </>
  );
}
