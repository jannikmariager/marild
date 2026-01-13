'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabaseBrowser';

interface Watchlist {
  id: string;
  name: string;
}

interface AddSymbolButtonProps {
  defaultWatchlistId?: string;
}

export function AddSymbolButton({ defaultWatchlistId }: AddSymbolButtonProps = {}) {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>(defaultWatchlistId || '');
  const [pinToDashboard, setPinToDashboard] = useState(false);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loadingWatchlists, setLoadingWatchlists] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      loadWatchlists();
    }
  }, [open]);

  useEffect(() => {
    if (defaultWatchlistId) {
      setSelectedWatchlistId(defaultWatchlistId);
    }
  }, [defaultWatchlistId]);

  async function loadWatchlists() {
    setLoadingWatchlists(true);
    try {
      const response = await fetch('/api/watchlists');
      if (response.ok) {
        const data = await response.json();
        setWatchlists(data.watchlists || []);
        
        // Auto-select first watchlist if none selected
        if (!selectedWatchlistId && data.watchlists && data.watchlists.length > 0) {
          setSelectedWatchlistId(data.watchlists[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to load watchlists:', error);
    } finally {
      setLoadingWatchlists(false);
    }
  }

  const handleAdd = async () => {
    setError('');
    
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) {
      setError('Please enter a symbol');
      return;
    }
    if (!/^[A-Z]{1,5}$/.test(cleanSymbol)) {
      setError('Symbol must be 1-5 uppercase letters');
      return;
    }

    if (!selectedWatchlistId) {
      setError('Please select a watchlist');
      return;
    }

    try {
      const response = await fetch(`/api/watchlists/${selectedWatchlistId}/symbols`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cleanSymbol,
          is_pinned: pinToDashboard,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.error === 'DUPLICATE_SYMBOL') {
          setError('Symbol already in this watchlist');
        } else {
          setError('Failed to add symbol');
        }
        return;
      }

      setOpen(false);
      setSymbol('');
      setPinToDashboard(false);
      
      // Refresh watchlist counts
      if ((window as any).__refreshWatchlists) {
        (window as any).__refreshWatchlists();
      }
      
      // Refresh page to show new symbol
      window.location.reload();
    } catch (error) {
      console.error('Error adding symbol:', error);
      setError('Failed to add symbol');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Symbol
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Watchlist</DialogTitle>
          <DialogDescription>
            Enter a stock symbol and choose which watchlist to add it to
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              placeholder="e.g. AAPL, MSFT, GOOGL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="uppercase"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="watchlist">Watchlist</Label>
            {loadingWatchlists ? (
              <div className="h-10 bg-gray-100 rounded animate-pulse" />
            ) : watchlists.length === 0 ? (
              <p className="text-sm text-gray-500">No watchlists available. Create one first.</p>
            ) : (
              <Select value={selectedWatchlistId} onValueChange={setSelectedWatchlistId}>
                <SelectTrigger id="watchlist">
                  <SelectValue placeholder="Select a watchlist" />
                </SelectTrigger>
                <SelectContent>
                  {watchlists.map((watchlist) => (
                    <SelectItem key={watchlist.id} value={watchlist.id}>
                      {watchlist.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="pin"
              checked={pinToDashboard}
              onCheckedChange={(checked) => setPinToDashboard(checked === true)}
            />
            <Label
              htmlFor="pin"
              className="text-sm font-normal cursor-pointer"
            >
              Pin to dashboard
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          
          <div className="flex space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleAdd} 
              className="flex-1"
              disabled={loadingWatchlists || watchlists.length === 0}
            >
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
