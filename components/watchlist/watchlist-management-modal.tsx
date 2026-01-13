'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface WatchlistManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rename' | 'delete';
  watchlistId?: string;
  currentName?: string;
  onSuccess: () => void;
}

export function WatchlistManagementModal({
  open,
  onOpenChange,
  mode,
  watchlistId,
  currentName = '',
  onSuccess,
}: WatchlistManagementModalProps) {
  const [name, setName] = useState(currentName);

  // Keep local name in sync when opening modal for different lists/modes
  useEffect(() => {
    if (open) {
      setName(currentName || '');
      setError(null);
    }
  }, [open, currentName, mode]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'create') {
        const response = await fetch('/api/watchlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });

        if (!response.ok) {
          const data = await response.json();
          if (data.error === 'DUPLICATE_NAME') {
            setError('A watchlist with this name already exists');
          } else {
            setError('Failed to create watchlist');
          }
          return;
        }
      } else if (mode === 'rename' && watchlistId) {
        const response = await fetch(`/api/watchlists/${watchlistId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });

        if (!response.ok) {
          const data = await response.json();
          if (data.error === 'DUPLICATE_NAME') {
            setError('A watchlist with this name already exists');
          } else {
            setError('Failed to rename watchlist');
          }
          return;
        }
      } else if (mode === 'delete' && watchlistId) {
        const response = await fetch(`/api/watchlists/${watchlistId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          setError('Failed to delete watchlist');
          return;
        }
      }

      // Success
      onSuccess();
      onOpenChange(false);
      setName('');
    } catch (err) {
      console.error('Watchlist operation error:', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    switch (mode) {
      case 'create':
        return 'Create New Watchlist';
      case 'rename':
        return 'Rename Watchlist';
      case 'delete':
        return 'Delete Watchlist';
    }
  };

  const getDescription = () => {
    switch (mode) {
      case 'create':
        return 'Create a new watchlist to organize your symbols.';
      case 'rename':
        return 'Enter a new name for this watchlist.';
      case 'delete':
        return 'Are you sure? This will permanently delete this watchlist and all its symbols.';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[30vw] min-w-[300px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{getTitle()}</DialogTitle>
            <DialogDescription>{getDescription()}</DialogDescription>
          </DialogHeader>

          {mode !== 'delete' && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Watchlist Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Tech Stocks, Day Trading, ETFs"
                  autoFocus
                  disabled={loading}
                />
              </div>
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>
          )}

          {mode === 'delete' && error && (
            <div className="py-4">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === 'delete' ? 'destructive' : 'default'}
              disabled={loading || (mode !== 'delete' && !name.trim())}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === 'create' && 'Create'}
              {mode === 'rename' && 'Rename'}
              {mode === 'delete' && 'Delete'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
