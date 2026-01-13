'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Watchlist {
  id: string;
  name: string;
  symbol_count: number;
  order_index: number;
}

interface WatchlistSwitcherProps {
  activeWatchlistId: string | null;
  onWatchlistChange: (watchlistId: string) => void;
  onCreateNew: () => void;
}

export function WatchlistSwitcher({
  activeWatchlistId,
  onWatchlistChange,
  onCreateNew,
}: WatchlistSwitcherProps) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWatchlists();
  }, []);

  async function loadWatchlists() {
    try {
      const response = await fetch('/api/watchlists');
      if (!response.ok) throw new Error('Failed to load watchlists');
      
      const data = await response.json();
      setWatchlists(data.watchlists || []);
      
      // If no active watchlist is selected and we have watchlists, select the first one
      if (!activeWatchlistId && data.watchlists && data.watchlists.length > 0) {
        onWatchlistChange(data.watchlists[0].id);
      }
    } catch (error) {
      console.error('Failed to load watchlists:', error);
    } finally {
      setLoading(false);
    }
  }

  // Expose refresh method
  useEffect(() => {
    // Store refresh function in window for external access
    (window as any).__refreshWatchlists = loadWatchlists;
    return () => {
      delete (window as any).__refreshWatchlists;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 w-24 bg-gray-200 rounded-full animate-pulse" />
        ))}
      </div>
    );
  }

  if (watchlists.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-gray-500">No watchlists yet</p>
        <Button
          size="sm"
          onClick={onCreateNew}
          className="h-8 gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Create Watchlist
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {watchlists.map((watchlist) => (
        <button
          key={watchlist.id}
          onClick={() => onWatchlistChange(watchlist.id)}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap',
            activeWatchlistId === watchlist.id
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          )}
        >
          {watchlist.name}
          <Badge
            variant="secondary"
            className={cn(
              'text-xs px-1.5 py-0',
              activeWatchlistId === watchlist.id
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-600'
            )}
          >
            {watchlist.symbol_count}
          </Badge>
        </button>
      ))}
      
      <Button
        size="sm"
        variant="outline"
        onClick={onCreateNew}
        className="h-8 gap-1.5 flex-shrink-0 border-dashed"
      >
        <Plus className="w-3.5 h-3.5" />
        New List
      </Button>
    </div>
  );
}
