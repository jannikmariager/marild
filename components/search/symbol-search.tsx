'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, AlertCircle, TrendingUp } from 'lucide-react';
import { createClient } from '@/lib/supabaseBrowser';
import { ApprovedTicker } from '@/types/approved-ticker';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TickerRequestModal } from '@/app/(app)/_components/ticker-request-modal';

interface SymbolSearchProps {
  mode?: 'header' | 'watchlist';
  onSelect?: (ticker: string) => void;
  onRequestTicker?: (ticker: string) => void;
  placeholder?: string;
  className?: string;
}

export function SymbolSearch({
  mode = 'header',
  onSelect,
  onRequestTicker,
  placeholder = 'Search stocks...',
  className,
}: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<ApprovedTicker[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotSupported, setShowNotSupported] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestTicker, setRequestTicker] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();

  // Search function with debouncing
  const searchTickers = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      // Show popular/recent tickers when empty
      setIsLoading(true);
      setError(null);
      setShowNotSupported(false);
      
      try {
        const { data, error: rpcError } = await supabase.rpc('search_approved_tickers', {
          _query: '',
          _limit: 10
        });

        if (rpcError) throw rpcError;
        
        setResults(data || []);
      } catch (err) {
        console.error('Error searching tickers:', err);
        setError('Could not search tickers right now. Please try again.');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setError(null);
    setShowNotSupported(false);

    try {
      const { data, error: rpcError } = await supabase.rpc('search_approved_tickers', {
        _query: searchQuery.toUpperCase(),
        _limit: 20
      });

      if (rpcError) throw rpcError;

      setResults(data || []);
      
      // Show "not supported" message if no results
      if (data && data.length === 0) {
        setShowNotSupported(true);
      }
    } catch (err) {
      console.error('Error searching tickers:', err);
      setError('Could not search tickers right now. Please try again.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  // Debounce search
  useEffect(() => {
    if (!isOpen) return;

    const timeoutId = setTimeout(() => {
      searchTickers(query);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [query, isOpen, searchTickers]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (ticker: string) => {
    setQuery('');
    setIsOpen(false);
    onSelect?.(ticker);
  };

  const handleRequestTicker = () => {
    setRequestTicker(query.toUpperCase());
    setRequestModalOpen(true);
    onRequestTicker?.(query.toUpperCase());
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <>
      {/* Ticker Request Modal */}
      <TickerRequestModal
        open={requestModalOpen}
        onOpenChange={setRequestModalOpen}
        initialTicker={requestTicker}
        source="search_empty"
        mode={undefined}
      />

      <div className={cn('relative w-full', className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full pl-10 pr-4 py-2 rounded-lg border bg-background',
            'focus:outline-none focus:ring-2 focus:ring-primary/20',
            'placeholder:text-muted-foreground',
            mode === 'header' ? 'h-10' : 'h-12'
          )}
        />
      </div>

      {/* Dropdown Results */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className={cn(
            'absolute z-50 w-full mt-2 rounded-lg border bg-background shadow-lg',
            'max-h-[400px] overflow-y-auto'
          )}
        >
          {/* Loading State */}
          {isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="p-4 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {!isLoading && !error && results.length > 0 && (
            <div className="py-2">
              {results.map((ticker) => (
                <button
                  key={ticker.ticker}
                  onClick={() => handleSelect(ticker.ticker)}
                  className={cn(
                    'w-full px-4 py-3 flex items-center justify-between',
                    'hover:bg-accent transition-colors text-left'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                      <TrendingUp className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">{ticker.ticker}</div>
                      <div className="flex gap-1 mt-1">
                        {ticker.segments.map((segment) => (
                          <Badge
                            key={segment}
                            variant="outline"
                            className={cn(
                              'text-xs',
                              segment === 'DAYTRADER' && 'border-green-500/50 text-green-600',
                              segment === 'SWING' && 'border-blue-500/50 text-blue-600',
                              segment === 'INVESTING' && 'border-amber-500/50 text-amber-600'
                            )}
                          >
                            {segment}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Not Supported State */}
          {!isLoading && !error && showNotSupported && query.trim() && (
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 space-y-2">
                  <p className="font-medium">This ticker is not yet supported</p>
                  <p className="text-sm text-muted-foreground">
                    <strong>{query.toUpperCase()}</strong> is not currently available in Marild AI.
                  </p>
                  {onRequestTicker && (
                    <button
                      onClick={handleRequestTicker}
                      className={cn(
                        'mt-3 px-4 py-2 rounded-lg',
                        'bg-primary text-primary-foreground',
                        'hover:bg-primary/90 transition-colors',
                        'text-sm font-medium'
                      )}
                    >
                      Request this ticker
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Empty State (no query, no results) */}
          {!isLoading && !error && !query.trim() && results.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Start typing to search for stocks
            </div>
          )}
        </div>
      )}
      </div>
    </>
  );
}
