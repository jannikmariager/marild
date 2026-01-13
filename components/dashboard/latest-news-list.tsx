'use client';

import { useEffect, useState } from 'react';
import { Newspaper, Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { timeAgo } from '@/lib/utils/timeAgo';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface NewsItem {
  title: string;
  source: string;
  published_at: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentiment_score: number;
  summary: string;
  url: string;
}

export function LatestNewsList() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNews();
  }, []);

  async function fetchNews() {
    setLoading(true);
    setError(null);

    try {
      // Prefer the live news pipeline (/api/news → Edge Function), but
      // gracefully fall back to the cached news (/api/news/latest) if that
      // fails, so the dashboard still shows something instead of erroring.
      let response = await fetch('/api/news?limit=5');

      if (!response.ok) {
        console.warn('[LatestNewsList] /api/news failed, falling back to /api/news/latest', response.status);
        response = await fetch('/api/news/latest?limit=5');
      }

      if (!response.ok) {
        throw new Error('Failed to fetch news');
      }

      const raw = await response.json();

      // Map both /api/news (headline/publishedAt/sentimentScore) and
      // /api/news/latest (title/published_at/sentiment_score) into a
      // unified NewsItem shape.
      const mapped: NewsItem[] = (raw || []).map((item: any) => ({
        title: item.headline ?? item.title ?? 'Untitled',
        source: item.source || 'Yahoo Finance',
        published_at: item.publishedAt ?? item.published_at ?? new Date().toISOString(),
        sentiment: (item.sentiment as NewsItem['sentiment']) || 'neutral',
        sentiment_score:
          typeof item.sentimentScore === 'number'
            ? item.sentimentScore
            : typeof item.sentiment_score === 'number'
              ? item.sentiment_score
              : 50,
        summary: item.summary ?? item.description ?? '',
        url: item.url || '#',
      }));

      setNews(mapped);
    } catch (err: any) {
      console.error('Failed to fetch news:', err);
      setError(err.message || 'Failed to load news');
    } finally {
      setLoading(false);
    }
  }


  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={fetchNews} />;
  }

  const latestNewsUpdatedAt = news.length > 0 ? news[0].published_at : new Date().toISOString();

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Latest News</h2>
        </div>
        <span className="text-xs text-gray-500">
          Updated {timeAgo(latestNewsUpdatedAt)}
        </span>
      </div>

      {news.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No news available</p>
      ) : (
        <ul className="space-y-4">
          {news.map((item, index) => (
            <li key={`${item.url}-${index}`}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg hover:bg-gray-50 transition border border-gray-100"
              >
                <div className="flex justify-between items-start gap-3">
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight flex-1">
                    {item.title}
                  </h3>

                  <Badge
                    variant="outline"
                    className={cn(
                      'flex-shrink-0',
                      item.sentiment === 'bullish'
                        ? 'border-[#0AAE84] text-[#0AAE84] bg-[#0AAE84]/5'
                        : item.sentiment === 'bearish'
                          ? 'border-red-600 text-red-700 bg-red-50'
                          : 'border-gray-400 text-gray-600 bg-gray-50'
                    )}
                  >
                    {item.sentiment} ({item.sentiment_score}%)
                  </Badge>
                </div>

                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{item.summary}</p>

                <p className="text-[11px] text-gray-400 mt-2">
                  {item.source} • {timeAgo(item.published_at)}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LoadingState() {
  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Latest News</h2>
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <ul className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <li key={i}>
            <Skeleton className="h-24 rounded-lg" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-[#0AAE84]" />
          <h2 className="text-lg font-semibold text-gray-900">Latest News</h2>
        </div>
      </div>
      <div className="text-center py-8">
        <p className="text-sm text-gray-600 mb-3">{error}</p>
        <Button onClick={onRetry} variant="outline" size="sm">
          Retry
        </Button>
      </div>
    </Card>
  );
}
