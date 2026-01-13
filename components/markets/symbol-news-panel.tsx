'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, ExternalLink } from 'lucide-react';
import { formatTimeAgo } from '@/lib/formatting';
import { NewsSentimentBadge } from '@/components/news/news-sentiment-badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface NewsArticle {
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore?: number;
  sentimentReason?: string;
}

interface SymbolNewsPanelProps {
  symbol: string;
  limit?: number;
}

export function SymbolNewsPanel({ symbol, limit = 10 }: SymbolNewsPanelProps) {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNews() {
      try {
        const response = await fetch(`/api/news/symbol?symbol=${symbol}&limit=${limit}`);
        if (response.ok) {
          const data = await response.json();
          setNews(data.articles || []);
        }
      } catch (error) {
        console.error(`Failed to fetch news for ${symbol}:`, error);
      } finally {
        setLoading(false);
      }
    }

    if (symbol) {
      fetchNews();
    }
  }, [symbol, limit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">News for {symbol}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded mb-2 w-3/4" />
                <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : news.length === 0 ? (
          <p className="text-sm text-muted-foreground">No news available for {symbol}</p>
        ) : (
          <TooltipProvider>
            <div className="space-y-4">
              {news.map((article, index) => (
                <a
                  key={`${article.url}-${index}`}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block group"
                >
                  <div className="border-b pb-4 last:border-0 hover:bg-muted/50 -mx-4 px-4 py-2 rounded transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {article.sentimentReason ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div>
                                  <NewsSentimentBadge
                                    sentiment={article.sentiment}
                                    score={article.sentimentScore}
                                    showIcon={false}
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
                              showIcon={false}
                            />
                          )}
                        </div>
                        <h4 className="text-sm font-medium leading-snug mb-2 line-clamp-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                          {article.headline}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{article.source}</span>
                          <span>•</span>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>{formatTimeAgo(article.publishedAt)}</span>
                          </div>
                        </div>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
