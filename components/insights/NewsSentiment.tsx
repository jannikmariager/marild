'use client';

import { BarChart3, ExternalLink, Lock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import { useRouter } from 'next/navigation';

type SentimentType = 'bullish' | 'neutral' | 'bearish';

interface NewsArticle {
  headline: string;
  description?: string;
  source?: string;
  url: string;
  published_at: string;
  sentiment_label: SentimentType;
  sentiment_score: number;
  sentiment_reason?: string;
}

interface SentimentOverview {
  overall_sentiment: SentimentType;
  sentiment_score: number;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  key_topics: string[];
  market_impact: 'positive' | 'negative' | 'neutral';
}

interface NewsSentimentProps {
  className?: string;
}

export default function NewsSentiment({ className = '' }: NewsSentimentProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [overview, setOverview] = useState<SentimentOverview | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [totalArticles, setTotalArticles] = useState(0);
  const [unlockedArticles, setUnlockedArticles] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchNews();
  }, []);

  const fetchNews = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/news-sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      });

      if (!response.ok) {
        // Silently fail - news sentiment is optional feature
        console.warn('News sentiment API unavailable:', response.status);
        setIsLoading(false);
        return;
      }

      const data = await response.json();
      setArticles(data.articles || []);
      setOverview(data.overview || null);
      setIsLocked(data.access?.is_locked || false);
      setTotalArticles(data.access?.total_articles || 0);
      setUnlockedArticles(data.access?.unlocked_articles || 0);
    } catch (err) {
      // Silently fail - news sentiment is optional feature
      console.warn('Error fetching news:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpgrade = () => {
    // Keep for potential analytics; UpgradeButton will handle the actual checkout redirect.
    router.prefetch('/account');
  };

  if (isLoading) {
    return <LoadingState className={className} />;
  }

  // If no articles loaded (API failed or unavailable), don't render anything
  if (articles.length === 0 && !overview) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Sentiment Overview - PRO Only */}
      {overview && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              News Sentiment Analysis
            </h3>
          </div>

          <SentimentBar
            sentiment={overview.overall_sentiment}
            score={overview.sentiment_score}
            bullishCount={overview.bullish_count}
            bearishCount={overview.bearish_count}
            neutralCount={overview.neutral_count}
          />

          {overview.key_topics.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-600 mb-2">Key Topics</p>
              <div className="flex flex-wrap gap-2">
                {overview.key_topics.map((topic, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Articles */}
      <div className="space-y-3">
        {articles.map((article, idx) => (
          <NewsArticleCard key={idx} article={article} />
        ))}
      </div>

      {/* Lock Indicator */}
      {isLocked && totalArticles > unlockedArticles && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Lock className="w-5 h-5 text-gray-400" />
              <div>
                <p className="font-semibold text-gray-900">
                  Unlock {totalArticles - unlockedArticles} more articles
                </p>
                <p className="text-sm text-gray-600">
                  Get full news coverage with PRO
                </p>
              </div>
            </div>
            <UpgradeButton size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}

function SentimentBar({
  sentiment,
  score,
  bullishCount,
  bearishCount,
  neutralCount,
}: {
  sentiment: SentimentType;
  score: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}) {
  const total = bullishCount + bearishCount + neutralCount;
  if (total === 0) return null;

  const bullishPercent = (bullishCount / total) * 100;
  const bearishPercent = (bearishCount / total) * 100;
  const neutralPercent = (neutralCount / total) * 100;

  const getSentimentIcon = () => {
    switch (sentiment) {
      case 'bullish':
        return <TrendingUp className="w-4 h-4" />;
      case 'bearish':
        return <TrendingDown className="w-4 h-4" />;
      default:
        return <Minus className="w-4 h-4" />;
    }
  };

  const getSentimentColor = () => {
    switch (sentiment) {
      case 'bullish':
        return 'text-[#0AAE84] bg-[#0AAE84]/10 border-[#0AAE84]/20';
      case 'bearish':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  return (
    <div>
      {/* Overall Sentiment Badge */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${getSentimentColor()}`}>
          {getSentimentIcon()}
          <span className="text-sm font-semibold capitalize">{sentiment}</span>
        </div>
        <span className="text-sm text-gray-600">
          Score: {Math.round(score * 100)}
        </span>
      </div>

      {/* Bar */}
      <div className="h-8 flex rounded-lg overflow-hidden">
        {bullishPercent > 0 && (
          <div
            className="bg-[#0AAE84] flex items-center justify-center"
            style={{ width: `${bullishPercent}%` }}
          >
            {bullishPercent > 15 && (
              <span className="text-xs font-semibold text-white">
                {Math.round(bullishPercent)}%
              </span>
            )}
          </div>
        )}
        {neutralPercent > 0 && (
          <div
            className="bg-gray-300 flex items-center justify-center"
            style={{ width: `${neutralPercent}%` }}
          >
            {neutralPercent > 15 && (
              <span className="text-xs font-semibold text-gray-700">
                {Math.round(neutralPercent)}%
              </span>
            )}
          </div>
        )}
        {bearishPercent > 0 && (
          <div
            className="bg-red-500 flex items-center justify-center"
            style={{ width: `${bearishPercent}%` }}
          >
            {bearishPercent > 15 && (
              <span className="text-xs font-semibold text-white">
                {Math.round(bearishPercent)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-[#0AAE84] rounded-sm" />
          <span className="text-gray-600">Bullish ({bullishCount})</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-gray-300 rounded-sm" />
          <span className="text-gray-600">Neutral ({neutralCount})</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded-sm" />
          <span className="text-gray-600">Bearish ({bearishCount})</span>
        </div>
      </div>
    </div>
  );
}

function NewsArticleCard({ article }: { article: NewsArticle }) {
  const getSentimentColor = (sentiment: SentimentType) => {
    switch (sentiment) {
      case 'bullish':
        return 'text-[#0AAE84] bg-[#0AAE84]/10';
      case 'bearish':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  };

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-lg border border-gray-200 p-4 shadow-sm hover:border-gray-300 transition-colors"
    >
      <div className="flex items-start gap-2 mb-2">
        <h4 className="flex-1 font-semibold text-gray-900 text-sm line-clamp-2">
          {article.headline}
        </h4>
        <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
      </div>

      {article.description && (
        <p className="text-sm text-gray-600 line-clamp-2 mb-3">
          {article.description}
        </p>
      )}

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-gray-500">
          {article.source && (
            <>
              <span className="truncate">{article.source}</span>
              <span>•</span>
            </>
          )}
          <span>{formatTimeAgo(article.published_at)}</span>
        </div>
        <span
          className={`px-2 py-0.5 rounded font-semibold ${getSentimentColor(article.sentiment_label)}`}
        >
          {article.sentiment_label}
        </span>
      </div>
    </a>
  );
}

function LoadingState({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-8 bg-gray-200 rounded" />
          <div className="flex gap-2">
            <div className="h-6 bg-gray-200 rounded w-20" />
            <div className="h-6 bg-gray-200 rounded w-20" />
            <div className="h-6 bg-gray-200 rounded w-20" />
          </div>
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-200 rounded w-full" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
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
