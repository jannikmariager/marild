'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Filter, Activity, User } from 'lucide-react';
import { useSignalsStore } from '@/lib/stores/signals-store';

export function SignalsFilters() {
  const { filters, setFilters, resetFilters } = useSignalsStore();
  const [searchInput, setSearchInput] = useState(filters.symbol || '');

  const handleSearch = () => {
    setFilters({ symbol: searchInput.toUpperCase() || undefined });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const toggleSignalType = (type: 'buy' | 'sell' | 'neutral') => {
    setFilters({
      signalType: filters.signalType === type ? undefined : type,
    });
  };

  const toggleTimeframe = (tf: string) => {
    setFilters({
      timeframe: filters.timeframe === tf ? undefined : tf,
    });
  };

  const toggleFreshness = (fresh: boolean) => {
    setFilters({
      freshOnly: filters.freshOnly === fresh ? undefined : fresh,
    });
  };

  const toggleSource = (source: 'user_requested' | 'performance_engine') => {
    setFilters({
      source: filters.source === source ? undefined : source,
    });
  };

  const toggleAiTraded = () => {
    setFilters({
      onlyTradedByAi: filters.onlyTradedByAi ? undefined : true,
    });
  };


  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] leading-none">i</span>
            <span>Signals: 1H timeframe</span>
          </div>
        </div>
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="flex space-x-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by symbol (e.g. AAPL, TSLA)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                onKeyDown={handleKeyPress}
                className="pl-9"
              />
            </div>
            <Button onClick={handleSearch} variant="secondary">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
            <Button onClick={resetFilters} variant="outline">
              Reset
            </Button>
          </div>

          {/* Filter Buttons */}
          <div className="flex flex-wrap gap-2">
            {/* Signal Type */}
            <div className="flex space-x-2">
              <span className="text-sm text-muted-foreground self-center">Type:</span>
              <Button
                size="sm"
                variant={filters.signalType === 'buy' ? 'default' : 'outline'}
                onClick={() => toggleSignalType('buy')}
              >
                Buy
              </Button>
              <Button
                size="sm"
                variant={filters.signalType === 'sell' ? 'destructive' : 'outline'}
                onClick={() => toggleSignalType('sell')}
              >
                Sell
              </Button>
              <Button
                size="sm"
                variant={filters.signalType === 'neutral' ? 'secondary' : 'outline'}
                onClick={() => toggleSignalType('neutral')}
              >
                Neutral
              </Button>
            </div>

            {/* Timeframe filter removed: default view is all recent signals regardless of timeframe */}

            {/* Freshness */}
            <div className="flex space-x-2 ml-4">
              <span className="text-sm text-muted-foreground self-center">Status:</span>
              <Button
                size="sm"
                variant={filters.freshOnly === true ? 'default' : 'outline'}
                onClick={() => toggleFreshness(true)}
              >
                Fresh (&lt;4h)
              </Button>
              <Button
                size="sm"
                variant={filters.freshOnly === false ? 'secondary' : 'outline'}
                onClick={() => toggleFreshness(false)}
              >
                Expired
              </Button>
            </div>
          </div>


          {/* Execution Filter */}
          <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
            <span className="text-sm font-medium">Execution:</span>
            <Button
              size="sm"
              variant={filters.onlyTradedByAi ? 'default' : 'outline'}
              onClick={toggleAiTraded}
              className={filters.onlyTradedByAi ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
            >
              Traded by AI
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
