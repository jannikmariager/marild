'use client';

import { TrendingUp, PieChart, Activity, Zap, Target, Lock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { UpgradeButton } from '@/components/billing/upgrade-button';

type InsightType = 'market_alert' | 'sector_rotation' | 'volatility_watch' | 'momentum_shift' | 'risk_opportunity';
type SentimentType = 'bullish' | 'neutral' | 'bearish';

interface InsightMetric {
  label: string;
  value: string;
  change?: string;
  sentiment?: SentimentType;
}

interface InsightCard {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  sentiment: SentimentType;
  metrics: InsightMetric[];
  timestamp: string;
  isLocked?: boolean;
}

interface InsightCardsProps {
  className?: string;
}

export default function InsightCards({ className = '' }: InsightCardsProps) {
  const [cards, setCards] = useState<InsightCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchInsights = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/ai-insight-cards');
      if (!response.ok) throw new Error('Failed to fetch insights');

      const data = await response.json();
      setCards(data.cards || []);
    } catch (err) {
      console.error('Error fetching insights:', err);
      setError('Failed to load insights');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingState className={className} />;
  }

  if (error) {
    return <ErrorState error={error} className={className} />;
  }

  if (cards.length === 0) {
    return <EmptyState className={className} />;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {cards.map((card) => (
        <InsightCardItem key={card.id} card={card} />
      ))}
    </div>
  );
}

function InsightCardItem({ card }: { card: InsightCard }) {
  const getTypeIcon = (type: InsightType) => {
    const iconClass = 'w-5 h-5';
    switch (type) {
      case 'market_alert':
        return <TrendingUp className={iconClass} />;
      case 'sector_rotation':
        return <PieChart className={iconClass} />;
      case 'volatility_watch':
        return <Activity className={iconClass} />;
      case 'momentum_shift':
        return <Zap className={iconClass} />;
      case 'risk_opportunity':
        return <Target className={iconClass} />;
    }
  };

  const getSentimentColor = (sentiment: SentimentType) => {
    switch (sentiment) {
      case 'bullish':
        return 'bg-green-50 text-green-600';
      case 'bearish':
        return 'bg-red-50 text-red-600';
      default:
        return 'bg-gray-50 text-gray-600';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="relative bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`p-2 rounded-lg ${getSentimentColor(card.sentiment)}`}>
          {getTypeIcon(card.type)}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900">{card.title}</h4>
          <p className="text-xs text-gray-500">{formatTimestamp(card.timestamp)}</p>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-700 mb-3">{card.description}</p>

      {/* Metrics */}
      {!card.isLocked && card.metrics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {card.metrics.map((metric, idx) => (
            <MetricBadge key={idx} metric={metric} />
          ))}
        </div>
      )}

      {/* Lock Overlay */}
      {card.isLocked && (
        <div className="absolute inset-0 bg-white/95 rounded-lg flex flex-col items-center justify-center p-6 backdrop-blur-sm">
          <Lock className="w-8 h-8 text-gray-400 mb-2" />
          <p className="font-semibold text-gray-900 mb-1">PRO Feature</p>
          <p className="text-sm text-gray-600 mb-4 text-center">
            Unlock all AI insights
          </p>
          <UpgradeButton size="sm">
            Upgrade to PRO
          </UpgradeButton>
        </div>
      )}
    </div>
  );
}

function MetricBadge({ metric }: { metric: InsightMetric }) {
  const getSentimentColor = (sentiment?: SentimentType) => {
    if (!sentiment) return 'border-gray-200 bg-gray-50';
    switch (sentiment) {
      case 'bullish':
        return 'border-green-200 bg-green-50';
      case 'bearish':
        return 'border-red-200 bg-red-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const getTextColor = (sentiment?: SentimentType) => {
    if (!sentiment) return 'text-gray-900';
    switch (sentiment) {
      case 'bullish':
        return 'text-green-700';
      case 'bearish':
        return 'text-red-700';
      default:
        return 'text-gray-700';
    }
  };

  return (
    <div className={`px-3 py-2 rounded-lg border ${getSentimentColor(metric.sentiment)}`}>
      <p className="text-xs text-gray-600 mb-0.5">{metric.label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-sm font-semibold ${getTextColor(metric.sentiment)}`}>
          {metric.value}
        </span>
        {metric.change && (
          <span className={`text-xs font-semibold ${getTextColor(metric.sentiment)}`}>
            {metric.change}
          </span>
        )}
      </div>
    </div>
  );
}

function LoadingState({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-gray-200 rounded w-1/3" />
            <div className="h-16 bg-gray-200 rounded" />
            <div className="flex gap-2">
              <div className="h-12 bg-gray-200 rounded w-24" />
              <div className="h-12 bg-gray-200 rounded w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ error, className = '' }: { error: string; className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-6 shadow-sm text-center ${className}`}>
      <p className="text-sm text-gray-500">{error}</p>
    </div>
  );
}

function EmptyState({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-6 shadow-sm text-center ${className}`}>
      <p className="text-sm text-gray-500">No insights available</p>
    </div>
  );
}
