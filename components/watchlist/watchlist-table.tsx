'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { createClient } from '@/lib/supabaseBrowser';
import Link from 'next/link';

interface WatchlistItem {
  symbol: string;
  added_at: string;
  latest_signal?: {
    signal_type: 'buy' | 'sell' | 'neutral';
    confidence_score: number;
    updated_at: string;
  };
}

export function WatchlistTable() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWatchlist = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setLoading(false);
      return;
    }

    // Fetch user's watchlist from database
    const { data: watchlist, error } = await supabase
      .from('user_watchlist')
      .select('symbol, added_at')
      .eq('user_id', user.id)
      .order('added_at', { ascending: false });

    if (error) {
      // Table doesn't exist yet or other error - treat as empty watchlist
      console.log('Watchlist table not available yet - showing empty state');
      setItems([]);
      setLoading(false);
      return;
    }

    if (!watchlist || watchlist.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    // Fetch latest signal for each symbol
    const watchlistWithSignals = await Promise.all(
      watchlist.map(async (item) => {
        const { data: signal } = await supabase
          .from('ai_signals')
          .select('signal_type, confidence_score, updated_at')
          .eq('symbol', item.symbol)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          ...item,
          latest_signal: signal || undefined,
        };
      })
    );

    setItems(watchlistWithSignals);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const handleRemove = async (symbol: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return;

    const { error } = await supabase
      .from('user_watchlist')
      .delete()
      .eq('user_id', user.id)
      .eq('symbol', symbol);

    if (error) {
      console.error('Error removing symbol:', error);
      return;
    }

    // Update UI
    setItems(items.filter((item) => item.symbol !== symbol));
  };

  const getSignalBadge = (type?: string) => {
    if (!type) return <Badge variant="outline">No Signal</Badge>;
    
    switch (type) {
      case 'buy':
        return <Badge variant="default"><TrendingUp className="h-3 w-3 mr-1" /> BUY</Badge>;
      case 'sell':
        return <Badge variant="destructive"><TrendingDown className="h-3 w-3 mr-1" /> SELL</Badge>;
      default:
        return <Badge variant="secondary">NEUTRAL</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">Loading watchlist...</p>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            Your watchlist is empty. Click “Add Symbol” to start tracking stocks.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Watchlist ({items.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-3 font-medium">Symbol</th>
                <th className="pb-3 font-medium">Latest Signal</th>
                <th className="pb-3 font-medium">Confidence</th>
                <th className="pb-3 font-medium">Last Updated</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.symbol} className="border-b last:border-0">
                  <td className="py-4">
                    <Link 
                      href={`/markets/${item.symbol}`}
                      className="font-mono font-bold hover:text-purple-600 transition-colors"
                    >
                      {item.symbol}
                    </Link>
                  </td>
                  <td className="py-4">
                    {getSignalBadge(item.latest_signal?.signal_type)}
                  </td>
                  <td className="py-4 text-sm">
                    {item.latest_signal?.confidence_score 
                      ? `${item.latest_signal.confidence_score}%`
                      : '-'}
                  </td>
                  <td className="py-4 text-sm text-muted-foreground">
                    {item.latest_signal?.updated_at
                      ? new Date(item.latest_signal.updated_at).toLocaleDateString()
                      : '-'}
                  </td>
                  <td className="py-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(item.symbol)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
