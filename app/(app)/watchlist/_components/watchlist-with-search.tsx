'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Lock } from 'lucide-react';
import { SymbolSearch } from '@/components/search/symbol-search';
import { useIsPro } from '@/hooks/useIsPro';
import { useUser } from '@/components/providers/user-provider';
import { addToWatchlist } from '@/lib/watchlist';
import { TickerRequestModal } from '@/app/(app)/_components/ticker-request-modal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface WatchlistWithSearchProps {
  existingWatchlist?: string[];
  onTickerAdded?: () => void;
}

export function WatchlistWithSearch({
  existingWatchlist = [],
  onTickerAdded,
}: WatchlistWithSearchProps) {
  const router = useRouter();
  const isPro = useIsPro();
  const user = useUser();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [requestedTicker, setRequestedTicker] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAddClick = () => {
    if (!isPro) {
      setShowUpgradeDialog(true);
      return;
    }
    setIsSearchOpen(true);
  };

  const handleTickerSelect = async (ticker: string) => {
    if (!user?.id) {
      setErrorMessage('Please sign in to add watchlist items.');
      return;
    }

    setIsAdding(true);
    setErrorMessage(null);

    try {
      const result = await addToWatchlist(ticker, user.id);

      if (result.success) {
        setIsSearchOpen(false);
        onTickerAdded?.();
        router.refresh();
      } else {
        setErrorMessage(result.error || 'Failed to add ticker to watchlist.');
      }
    } catch (err) {
      console.error('Error adding to watchlist:', err);
      setErrorMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRequestTicker = (ticker: string) => {
    setRequestedTicker(ticker);
    setIsSearchOpen(false);
    setShowRequestDialog(true);
  };

  return (
    <>
      {/* Add to Watchlist Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleAddClick}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-primary text-primary-foreground',
            'hover:bg-primary/90 transition-colors',
            'font-medium'
          )}
        >
          <Plus className="h-4 w-4" />
          Add to Watchlist
        </button>

        {!isPro && (
          <Badge variant="outline" className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            PRO Feature
          </Badge>
        )}
      </div>

      {/* Search Dialog */}
      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add Stock to Watchlist</DialogTitle>
            <DialogDescription>
              Search for approved stocks to add to your watchlist
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <SymbolSearch
              mode="watchlist"
              onSelect={handleTickerSelect}
              onRequestTicker={handleRequestTicker}
              placeholder="Search by ticker symbol..."
              className="w-full"
            />

            {errorMessage && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {errorMessage}
              </div>
            )}

            {isAdding && (
              <div className="text-center text-sm text-muted-foreground">
                Adding to watchlist...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upgrade Dialog */}
      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upgrade to PRO</DialogTitle>
            <DialogDescription>
              Watchlists are a Pro feature
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Upgrade to Marild AI Pro to unlock unlimited watchlists, real-time AI signals,
              and advanced market insights.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowUpgradeDialog(false);
                  router.push('/pricing');
                }}
                className={cn(
                  'flex-1 px-4 py-2 rounded-lg',
                  'bg-primary text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                  'font-medium'
                )}
              >
                View Pricing
              </button>
              <button
                onClick={() => setShowUpgradeDialog(false)}
                className={cn(
                  'px-4 py-2 rounded-lg',
                  'border border-border',
                  'hover:bg-accent transition-colors'
                )}
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Request Ticker Modal */}
      <TickerRequestModal
        open={showRequestDialog}
        onOpenChange={setShowRequestDialog}
        initialTicker={requestedTicker}
        source="watchlist_block"
        mode={undefined}
      />
    </>
  );
}
