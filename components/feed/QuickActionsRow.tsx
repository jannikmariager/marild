'use client';

import { useState } from 'react';
import { Zap, Target, TrendingUp, TrendingDown, PieChart, Shield, Calendar, Activity, X, Loader2, Plus, BarChart, Eye, Check } from 'lucide-react';
import { useQuickActions } from '@/lib/hooks/useAiFeed';
import ProLockedCard from './ProLockedCard';
import type { QuickAction } from '@/types/aiFeed';

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
  const { actions, isLocked, isLoading, error } = useQuickActions();
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QuickActionResult | null>(null);
  const [showModal, setShowModal] = useState(false);

  if (isLoading) {
    return <LoadingState />;
  }

  if (error && !isLocked) {
    return <ErrorState />;
  }

  const getIconForAction = (iconName: string) => {
    switch (iconName.toLowerCase()) {
      case 'target':
        return Target;
      case 'trendingup':
        return TrendingUp;
      case 'trendingdown':
        return TrendingDown;
      case 'zap':
        return Zap;
      case 'piechart':
        return PieChart;
      case 'shield':
        return Shield;
      case 'calendar':
        return Calendar;
      case 'activity':
        return Activity;
      default:
        return Zap;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'analysis':
        return 'bg-blue-50 text-blue-600';
      case 'scan':
        return 'bg-green-50 text-green-600';
      case 'research':
        return 'bg-purple-50 text-purple-600';
      default:
        return 'bg-gray-50 text-gray-600';
    }
  };

  const handleActionClick = async (action: QuickAction) => {
    setExecuting(true);
    setShowModal(true);
    setResult(null);

    try {
      const response = await fetch('/api/execute-quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.id }),
      });

      if (!response.ok) {
        if (response.status === 402) {
          // Handle PRO required
          throw new Error('This feature requires Marild Pro');
        }
        throw new Error('Failed to execute action');
      }

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Error executing action:', error);
      // Show error in modal
      setResult({
        action: action.id,
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

  return (
    <ProLockedCard
      isLocked={isLocked}
      featureName="Quick AI Actions"
      description="Fast access to powerful AI tools"
    >
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm py-5">
        {/* Header */}
        <div className="px-5 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Zap className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              Quick AI Actions
            </h3>
          </div>
        </div>

        {/* Actions Grid - 2 Horizontal Rows of 7 */}
        {actions && actions.length > 0 && !isLocked && (
          <div className="px-5 space-y-3">
            {/* First Row - Actions 1-7 */}
            <div className="flex gap-2 justify-between">
              {actions.slice(0, 7).map((action) => {
                const Icon = getIconForAction(action.icon);
                return (
                  <button
                    key={action.id}
                    onClick={() => handleActionClick(action)}
                    disabled={executing}
                    className="flex-shrink-0 w-28 p-2.5 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={`p-2 rounded-full ${getCategoryColor(action.category)}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-gray-900 text-center leading-tight line-clamp-2">
                        {action.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            
            {/* Second Row - Actions 8-14 */}
            <div className="flex gap-2 justify-between">
              {actions.slice(7, 14).map((action) => {
                const Icon = getIconForAction(action.icon);
                return (
                  <button
                    key={action.id}
                    onClick={() => handleActionClick(action)}
                    disabled={executing}
                    className="flex-shrink-0 w-28 p-2.5 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={`p-2 rounded-full ${getCategoryColor(action.category)}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-gray-900 text-center leading-tight line-clamp-2">
                        {action.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
    </ProLockedCard>
  );
}

function LoadingState() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm py-5">
      <div className="overflow-x-auto">
        <div className="flex gap-3 px-5">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-32 h-24 bg-gray-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <p className="text-sm text-gray-500 text-center">
        Failed to load actions
      </p>
    </div>
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
    
    // Extract symbol from insight ID (usually format: "symbol" or "symbol-action")
    const symbol = insightId.split('-')[0];
    
    try {
      switch (actionType) {
        case 'add-to-watchlist':
          // Watchlists have been removed; ignore silently for now.
          break;
        case 'open-chart':
          // Navigate to symbol page
          window.location.assign(`/markets/${symbol}`);
          break;
        case 'mark-read':
          // TODO: Implement mark as read
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
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
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
                              <BarChart className="w-3.5 h-3.5" />
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
