'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';

interface IndexQuote {
  symbol: string;
  price: number | null;
  changePercent: number | null;
}

export function MarketSummaryCard() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchIndices() {
      try {
        const response = await fetch('/api/market/quotes');
        if (response.ok) {
          const data = await response.json();
          setIndices(data.quotes || []);
        }
      } catch (error) {
        console.error('Failed to fetch market indices:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchIndices();
  }, []);

  // Generate summary from live data
  const summary = loading
    ? 'Loading market data...'
    : (() => {
        const sp500 = indices.find(i => i.symbol === '^GSPC');
        const nasdaq = indices.find(i => i.symbol === '^IXIC');
        
        const sp500Change = sp500?.changePercent || 0;
        const nasdaqChange = nasdaq?.changePercent || 0;
        
        const avgChange = (sp500Change + nasdaqChange) / 2;
        const direction = avgChange > 0 ? 'higher' : avgChange < 0 ? 'lower' : 'flat';
        const performance = avgChange > 0.5 ? 'strong gains' : avgChange < -0.5 ? 'losses' : 'mixed performance';
        
        return `Markets closed ${direction} today with ${performance}. The S&P 500 ${sp500Change > 0 ? 'gained' : 'declined'} ${Math.abs(sp500Change).toFixed(2)}% while the Nasdaq ${nasdaqChange > 0 ? 'rose' : 'fell'} ${Math.abs(nasdaqChange).toFixed(2)}%.`;
      })();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5" />
              <span>Today&apos;s Market Summary</span>
            </CardTitle>
            <CardDescription>Live market data</CardDescription>
          </div>
          <Button variant="outline" size="sm">
            View Full Insight
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </CardContent>
    </Card>
  );
}
