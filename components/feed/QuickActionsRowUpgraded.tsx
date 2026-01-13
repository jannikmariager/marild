'use client';

import { useState, useEffect } from 'react';
import { 
  Sparkles, Target, TrendingUp, TrendingDown, 
  Activity, Shield, Loader2, Lock, BarChart3,
  ArrowUpCircle, ArrowDownCircle, Crosshair, Zap,
  X, Plus, Eye, Check, PieChart
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface QuickAction {
  id: string;
  title: string;
  subtitle: string;
  icon: any;
  backendActionId: string; // Maps to backend action ID
}

interface QuickActionMetric {
  label: string;
  value: string;
  hint?: string;
}

interface QuickActionReasonLine {
  label: string;
  detail: string;
}

interface QuickActionResult {
  action: string;
  generatedAt: string;
  headline: string;
  summary: string;
  insights: Array<{
    id: string;
    title: string;
    subtitle?: string;
    body: string;
    severity?: 'info' | 'opportunity' | 'risk' | 'warning';
    tags?: string[];
    metrics?: QuickActionMetric[];
    reasons?: QuickActionReasonLine[];
    userActions?: {
      canAddToWatchlist?: boolean;
      canRequestTradeSignal?: boolean;
      canOpenChart?: boolean;
      canMarkRead?: boolean;
    };
  }>;
  disclaimer: string;
}

export default function QuickActionsRow() {
  const [isProOrTrial] = useState(true); // In DEV mode, always show as unlocked
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QuickActionResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);
  const [headerNextRefreshAt, setHeaderNextRefreshAt] = useState<string | null>(null);
  const [history, setHistory] = useState<QuickActionResult[]>([]);

  // Final 12 actions in 3×4 grid - mapped to backend action IDs
  const actions: QuickAction[] = [
    {
      id: 'analyze-watchlist',
      title: 'Analyze Watchlist',
      subtitle: 'Scan your watchlist for patterns',
      icon: Target,
      backendActionId: 'analyze-watchlist',
    },
    {
      id: 'bullish-setups',
      title: 'Bullish Setups',
      subtitle: 'Strong upward technical patterns',
      icon: ArrowUpCircle,
      backendActionId: 'find-bullish-setups',
    },
    {
      id: 'bearish-setups',
      title: 'Bearish Setups',
      subtitle: 'Weakening / failing setups',
      icon: ArrowDownCircle,
      backendActionId: 'find-bearish-setups',
    },
    {
      id: 'future-breakouts',
      title: 'Future Breakouts',
      subtitle: 'Near breakout zones',
      icon: Zap,
      backendActionId: 'scan-breakouts',
    },
    {
      id: 'find-oversold',
      title: 'Find Oversold',
      subtitle: 'Potential reversal zones',
      icon: TrendingDown,
      backendActionId: 'find-oversold-stocks',
    },
    {
      id: 'find-overbought',
      title: 'Find Overbought',
      subtitle: 'Extended moves, potential pullback',
      icon: TrendingUp,
      backendActionId: 'find-overbought-stocks',
    },
    {
      id: 'trend-reversals',
      title: 'Trend Reversals',
      subtitle: 'Major trend shift signals',
      icon: Activity,
      backendActionId: 'detect-trend-reversals',
    },
    {
      id: 'sector-rotation',
      title: 'Sector Rotation',
      subtitle: 'Identify sector shifts',
      icon: PieChart,
      backendActionId: 'check-sector-rotation',
    },
    {
      id: 'high-volatility',
      title: 'High Volatility',
      subtitle: 'Active movers with momentum',
      icon: Zap,
      backendActionId: 'volatility-risk-regime',
    },
    {
      id: 'upcoming-earnings',
      title: 'Upcoming Earnings',
      subtitle: 'Companies reporting this week',
      icon: Shield,
      backendActionId: 'upcoming-earnings',
    },
    {
      id: 'momentum-leaders',
      title: 'Momentum Leaders',
      subtitle: 'Strong trending stocks',
      icon: TrendingUp,
      backendActionId: 'find-momentum-leaders',
    },
    {
      id: 'short-squeeze',
      title: 'Short Squeeze',
      subtitle: 'High short interest potential',
      icon: Crosshair,
      backendActionId: 'high-short-interest',
    },
  ];

  async function loadHistory() {
    try {
      const res = await fetch('/api/quick-actions/history?limit=30');
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.reports || []);
    } catch (e) {
      console.error('Failed to load quick action history', e);
    }
  }

  const handleActionClick = async (action: QuickAction) => {
    setExecuting(true);
    setShowModal(true);
    setResult(null);

    try {
      const response = await fetch('/api/execute-quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.backendActionId }),
      });

      if (!response.ok) {
        if (response.status === 402) {
          throw new Error('This feature requires Marild Pro');
        }
        throw new Error('Failed to execute action');
      }

      const data = await response.json();

      // If cached, show a gentle notification about next refresh time
      if ((data as any)?.cached && (data as any)?.next_refresh_at) {
        const next = new Date((data as any).next_refresh_at).getTime();
        const now = Date.now();
        const mins = Math.max(1, Math.ceil((next - now) / 60000));
        toast.info(`No new data available`, {
          description: `Report was cached. Next refresh in ~${mins} minute${mins !== 1 ? 's' : ''}.`,
          duration: 5000,
        });
      }

      // Update header timestamps based on server metadata
      setHeaderUpdatedAt((data as any)?.cached_at ?? new Date().toISOString());
      setHeaderNextRefreshAt((data as any)?.next_refresh_at ?? null);

      setResult(data);
      // Refresh history list so this run appears immediately
      loadHistory();
    } catch (error) {
      console.error('Error executing action:', error);
      setResult({
        action: action.backendActionId,
        generatedAt: new Date().toISOString(),
        headline: 'Error',
        summary: error instanceof Error ? error.message : 'Failed to execute action',
        insights: [],
        disclaimer: '',
      });
    } finally {
      setExecuting(false);
    }
  };

  // Load history on first render
  useEffect(() => {
    loadHistory();
  }, []);

  if (!isProOrTrial) {
    return <LockedState />;
  }

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
        </div>
        {headerUpdatedAt ? (
          <span className="text-xs text-gray-500">{formatUpdatedLabel(headerUpdatedAt)}</span>
        ) : null}
      </div>

      {/* 3×4 grid layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => handleActionClick(action)}
            disabled={executing}
            className="group bg-white border border-gray-200 p-4 rounded-lg 
                       hover:shadow-md hover:border-[#0AAE84]/40 transition 
                       flex items-center gap-3 text-left
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="p-2.5 rounded-lg bg-[#0AAE84]/10 flex-shrink-0">
              <action.icon className="w-5 h-5 text-[#0AAE84]" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 text-sm leading-tight mb-0.5">
                {action.title}
              </p>
              <p className="text-xs text-gray-500 line-clamp-1">
                {action.subtitle}
              </p>
            </div>
            
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#0AAE84] transition flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* Recent reports history */}
      {history.length > 0 && (
        <div className="mt-5 border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">Recent AI Reports</p>
            <button
              onClick={loadHistory}
              className="text-[11px] text-gray-500 hover:text-gray-800"
            >
              Refresh
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {history.map((h, idx) => {
              const label = actions.find(a => a.backendActionId === h.action)?.title || h.action;
              return (
                <button
                  key={`${h.action}-${h.generatedAt}-${idx}`}
                  className="w-full text-left flex items-center justify-between px-2 py-1 rounded hover:bg-gray-50 text-xs"
                  onClick={() => {
                    setResult(h);
                    setShowModal(true);
                  }}
                >
                  <span className="truncate max-w-[65%]">
                    {label} · {h.headline}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {formatUpdatedLabel(h.generatedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Result Modal */}
      {showModal && (
        <ResultModal
          result={result}
          loading={executing}
          onClose={() => {
            setShowModal(false);
            setResult(null);
          }}
        />
      )}
    </Card>
  );
}

function formatUpdatedLabel(iso: string) {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - ts);
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins}m ago`;
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function LockedState() {
  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6 relative overflow-hidden">
      {/* Blurred content */}
      <div className="opacity-40 pointer-events-none">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Quick AI Actions</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
        <div className="text-center">
          <Lock className="h-12 w-12 text-gray-700 mx-auto mb-3" />
          <p className="font-semibold mb-2 text-gray-900">Upgrade to PRO</p>
          <p className="text-gray-600 text-sm mb-3">Unlock advanced market insights</p>
          <UpgradeButton className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white" />
        </div>
      </div>
    </Card>
  );
}

function ResultModal({
  result,
  loading,
  onClose,
}: {
  result: QuickActionResult | null;
  loading: boolean;
  onClose: () => void;
}) {
  const handleUserAction = async (actionType: string, insightId: string) => {
    console.log(`User action: ${actionType} for ${insightId}`);
    
    const symbol = insightId.split('-')[0];
    
    try {
      switch (actionType) {
        case 'add-to-watchlist':
          // Watchlists have been removed; ignore silently for now.
          break;
        case 'open-chart':
          window.location.assign(`/markets/${symbol}`);
          break;
        case 'mark-read':
          alert(`Marked ${insightId} as read (API not implemented yet)`);
          break;
      }
    } catch (error) {
      console.error('User action error:', error);
    }
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'opportunity':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'risk':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      default:
        return 'bg-blue-50 border-blue-200 text-blue-800';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header - Sticky */}
        <div className="flex-shrink-0 flex items-center justify-between p-6 border-b bg-white sticky top-0 z-10">
          <h2 className="text-xl font-bold text-gray-900">
            {loading ? 'Analyzing...' : result?.headline || 'AI Analysis'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-12 h-12 animate-spin text-[#0AAE84] mb-4" />
              <p className="text-gray-600">Running AI analysis...</p>
            </div>
          ) : result ? (
            <div className="p-6 space-y-6">
              {/* Summary */}
              <div>
                <p className="text-gray-700 leading-relaxed">{result.summary}</p>
              </div>

              {/* Insights */}
              {result.insights && result.insights.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">Key Insights</h3>
                  {result.insights.map((insight) => (
                    <div
                      key={insight.id}
                      className={`p-4 rounded-lg border ${
                        getSeverityColor(insight.severity)
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold">{insight.title}</h4>
                          {insight.subtitle && (
                            <p className="text-sm opacity-80">{insight.subtitle}</p>
                          )}
                        </div>
                        {insight.tags && insight.tags.length > 0 && (
                          <div className="flex gap-1">
                            {insight.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-1 text-xs font-medium bg-white/50 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Why this was detected */}
                      {insight.reasons && insight.reasons.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-600 mb-2">Why this was detected</p>
                          <ul className="space-y-1">
                            {insight.reasons.map((reason, idx) => (
                              <li key={idx} className="text-xs">
                                <span className="font-medium">{reason.label}:</span>{' '}
                                <span className="text-gray-600">{reason.detail}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {/* Metrics grid */}
                      {insight.metrics && insight.metrics.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-600 mb-2">Key metrics</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {insight.metrics.map((metric, idx) => (
                              <div
                                key={idx}
                                className="rounded-md bg-gray-50 px-2 py-1.5 flex flex-col gap-0.5"
                              >
                                <span className="text-[10px] uppercase text-gray-500">
                                  {metric.label}
                                </span>
                                <span className="text-xs font-semibold text-gray-900">{metric.value}</span>
                                {metric.hint && (
                                  <span className="text-[10px] text-gray-500">
                                    {metric.hint}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <p className="text-sm mb-3">{insight.body}</p>
                      
                      {/* User Actions */}
                      {insight.userActions && (
                        <div className="flex gap-2 mt-3 pt-3 border-t">
                          {insight.userActions.canAddToWatchlist && (
                            <button
                              onClick={() => handleUserAction('add-to-watchlist', insight.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add to Watchlist
                            </button>
                          )}
                          {/* Manual TradeSignal requests are no longer exposed from Quick Actions. */}
                          {false && insight.userActions?.canRequestTradeSignal && (
                            <button
                              onClick={() => handleUserAction('request-tradesignal', insight.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                            >
                              <BarChart3 className="w-3.5 h-3.5" />
                              Request Signal
                            </button>
                          )}
                          {insight.userActions.canOpenChart && (
                            <button
                              onClick={() => handleUserAction('open-chart', insight.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Open Chart
                            </button>
                          )}
                          {insight.userActions.canMarkRead && (
                            <button
                              onClick={() => handleUserAction('mark-read', insight.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Mark Read
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Disclaimer */}
              {result.disclaimer && (
                <div className="text-xs text-gray-500 border-t pt-4">
                  {result.disclaimer}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex-shrink-0 flex justify-end gap-3 p-6 border-t">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
