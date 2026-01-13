'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock } from 'lucide-react';
import { formatTimeAgo } from '@/lib/formatting';
import { NewsSentimentBadge } from '@/components/news/news-sentiment-badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface NewsArticle {
  id: string;
  headline: string;
  source: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore?: number;
  sentimentReason?: string;
  publishedAt: string;
  summary: string | null;
}

export function NewsFeed() {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNews() {
      try {
        const response = await fetch('/api/news?limit=20');
        if (response.ok) {
          const data = await response.json();
          // Transform to match component format
          const transformedNews = data.map((item: any) => ({
            id: item.url,
            headline: item.headline,
            source: item.source || 'Yahoo Finance',
            sentiment: item.sentiment || 'neutral',
            sentimentScore: item.sentimentScore,
            sentimentReason: item.sentimentReason,
            publishedAt: item.publishedAt,
            summary: item.summary,
          }));
          setNews(transformedNews);
        }
      } catch (error) {
        console.error('Failed to fetch news:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchNews();
  }, []);


  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Loading news...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {news.map((article) => (
          <Card key={article.id} className="hover:border-purple-200 dark:hover:border-purple-800 transition-colors cursor-pointer">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <CardTitle className="text-lg">{article.headline}</CardTitle>
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    <span>{article.source}</span>
                    <div className="flex items-center space-x-1">
                      <Clock className="h-3 w-3" />
                      <span>{formatTimeAgo(article.publishedAt)}</span>
                    </div>
                  </div>
                </div>
                {article.sentimentReason ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <NewsSentimentBadge
                          sentiment={article.sentiment}
                          score={article.sentimentScore}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-sm">{article.sentimentReason}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <NewsSentimentBadge
                    sentiment={article.sentiment}
                    score={article.sentimentScore}
                  />
                )}
              </div>
            </CardHeader>
            {article.summary && (
              <CardContent>
                <p className="text-sm text-muted-foreground">{article.summary}</p>
              </CardContent>
            )}
          </Card>
        ))}
      
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground text-sm">
              More news coming soon. Connect your watchlist for personalized news alerts.
            </p>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
