'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Trade {
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  entry_time: string;
  entry_price: number;
  exit_time: string | null;
  exit_price: number | null;
  result: string;
  pnl_pct: number | null;
  bars_held: number | null;
}

interface GroupedTrades {
  today: Trade[];
  yesterday: Trade[];
  thisWeek: Trade[];
  older: Trade[];
}

export default function AITradeLog() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const itemsPerPage = 50;
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    today: true,
    yesterday: false,
    thisWeek: false,
    older: false,
  });

  useEffect(() => {
    if (isExpanded) {
      loadTrades();
    }
  }, [isExpanded, currentPage]);

  async function loadTrades() {
    setIsLoading(true);
    setError(null);

    try {
      const offset = (currentPage - 1) * itemsPerPage;
      const response = await fetch(`/api/performance/trades?limit=${itemsPerPage}&offset=${offset}`);
      if (!response.ok) {
        throw new Error(`Failed to load trades: ${response.status}`);
      }
      const json = await response.json();
      
      if (json.access?.is_locked) {
        setError('Upgrade to PRO to view trade history');
        setTrades([]);
        setTotalCount(0);
      } else {
        setTrades(json.trades || []);
        setTotalCount(json.pagination?.total || 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trades');
    } finally {
      setIsLoading(false);
    }
  }

  const groupTradesByDate = (trades: Trade[]): GroupedTrades => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const grouped: GroupedTrades = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: [],
    };

    trades.forEach((trade) => {
      const exitTime = trade.exit_time ? new Date(trade.exit_time) : new Date(trade.entry_time);
      
      if (exitTime >= todayStart) {
        grouped.today.push(trade);
      } else if (exitTime >= yesterdayStart) {
        grouped.yesterday.push(trade);
      } else if (exitTime >= weekStart) {
        grouped.thisWeek.push(trade);
      } else {
        grouped.older.push(trade);
      }
    });

    return grouped;
  };

  const formatDuration = (entryTime: string, exitTime: string | null) => {
    const entry = new Date(entryTime);
    const exit = exitTime ? new Date(exitTime) : new Date();
    const diffMs = exit.getTime() - entry.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return `${days}d ${remHours}h`;
    }
    return `${hours}h ${mins}m`;
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const renderTradeRow = (trade: Trade) => {
    const isPositive = (trade.pnl_pct ?? 0) > 0;
    const isNegative = (trade.pnl_pct ?? 0) < 0;
    const pnlColor = isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-500';
    const sideColor = trade.direction === 'SHORT'
      ? 'bg-red-100 text-red-700 border-red-300'
      : 'bg-emerald-50 text-emerald-700 border-emerald-300';

    return (
      <tr key={`${trade.symbol}-${trade.entry_time}`} className="border-b text-sm">
        <td className="py-3 font-medium">{trade.symbol}</td>
        <td className="py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${sideColor}`}>
            {trade.direction}
          </span>
        </td>
        <td className="py-3 text-xs">{trade.timeframe}</td>
        <td className="py-3">${trade.entry_price?.toFixed(2) || 'N/A'}</td>
        <td className="py-3">{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : 'N/A'}</td>
        <td className="py-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
            {trade.result.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="py-3 text-xs text-gray-600">
          {trade.exit_time ? formatTimeAgo(trade.exit_time) : `Opened ${formatTimeAgo(trade.entry_time)}`}
        </td>
        <td className={`py-3 text-right font-medium ${pnlColor}`}>
          {trade.pnl_pct !== null 
            ? `${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(2)}%`
            : 'Pending'}
        </td>
      </tr>
    );
  };

  const renderGroup = (title: string, groupKey: string, groupTrades: Trade[]) => {
    if (groupTrades.length === 0) return null;

    const isGroupExpanded = expandedGroups[groupKey];

    return (
      <div key={groupKey} className="space-y-3">
        <button
          onClick={() => toggleGroup(groupKey)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-900 hover:text-[#0AAE84] transition-colors"
        >
          {isGroupExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          {title} ({groupTrades.length})
        </button>
        {isGroupExpanded && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-600">
                  <th className="pb-3">Ticker</th>
                  <th className="pb-3">Side</th>
                  <th className="pb-3">Strategy</th>
                  <th className="pb-3">Entry</th>
                  <th className="pb-3">Exit</th>
                  <th className="pb-3">Reason</th>
                  <th className="pb-3">Time</th>
                  <th className="pb-3 text-right">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {groupTrades.map(renderTradeRow)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const grouped = groupTradesByDate(trades);
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalCount);

  return (
    <Card className="border-gray-200 rounded-xl bg-white">
      <CardHeader className="pb-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-start justify-between w-full text-left"
        >
          <div>
            <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
              AI Trade Log (Full History)
            </CardTitle>
            <p className="text-xs text-gray-600 mt-1 ml-7">
              All trades automatically executed by our AI engine.
            </p>
          </div>
        </button>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 space-y-4">
          {isLoading ? (
            <p className="text-sm text-gray-600">Loading trade history...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : trades.length === 0 ? (
            <p className="text-sm text-gray-700">
              No trades executed yet — this section will populate automatically once the AI engine performs new trades.
            </p>
          ) : (
            <>
              {/* Showing indicator */}
              {totalCount > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500 pb-2 border-b">
                  <span>
                    Showing {startItem}-{endItem} of {totalCount.toLocaleString()} trades
                  </span>
                  <span>Page {currentPage} of {totalPages}</span>
                </div>
              )}

              {renderGroup('Today', 'today', grouped.today)}
              {renderGroup('Yesterday', 'yesterday', grouped.yesterday)}
              {renderGroup('This Week', 'thisWeek', grouped.thisWeek)}
              {renderGroup('Older Trades', 'older', grouped.older)}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between pt-4 border-t">
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
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
