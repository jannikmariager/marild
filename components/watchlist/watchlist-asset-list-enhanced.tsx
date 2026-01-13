'use client';

import { useEffect, useState } from 'react';
import { AssetCard } from '@/app/(components)/asset-card'
import { AddSymbolButton } from '@/components/watchlist/add-symbol-button';
import { WatchlistSwitcher } from '@/components/watchlist/watchlist-switcher';
import { WatchlistManagementModal } from '@/components/watchlist/watchlist-management-modal';
import { createClient } from '@/lib/supabaseBrowser';
import { Star, Trash2, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface WatchlistSymbol {
  id: string;
  symbol: string;
  order_index: number;
  is_pinned: boolean;
  added_at: string;
}

interface PriceItem {
  symbol: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  latestSignalType: 'buy' | 'sell' | 'neutral' | null;
  latestSignalConfidence: number | null;
  sparkline: number[] | null;
  updatedAt: string | null;
}

export function WatchlistAssetListEnhanced() {
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const [items, setItems] = useState<WatchlistSymbol[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceItem>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'rename' | 'delete'>('create');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (activeWatchlistId) {
      loadWatchlistSymbols();
    }
  }, [activeWatchlistId]);

  async function loadWatchlistSymbols() {
    if (!activeWatchlistId) return;
    
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setItems([]);
        setLoading(false);
        return;
      }

      // Fetch symbols for this watchlist
      const response = await fetch(`/api/watchlists/${activeWatchlistId}/symbols`);
      if (!response.ok) {
        setItems([]);
        setLoading(false);
        return;
      }

      const data = await response.json();
      const watchlist = data.symbols || [];

      if (watchlist.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      setItems(watchlist as WatchlistSymbol[]);

      const symbols = watchlist.map((w: WatchlistSymbol) => w.symbol.toUpperCase());

      // Fetch price data (no AI cost)
      const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`);
      let priceData: PriceItem[] = [];
      if (res.ok) {
        priceData = await res.json();
      }

      // Fetch latest signals in bulk (from DB only, no new AI calls)
      const { data: signals } = await supabase
        .from('ai_signals')
        .select('symbol, signal_type, confidence_score, updated_at')
        .in('symbol', symbols)
        .order('updated_at', { ascending: false });

      const latestBySymbol: Record<string, { type: 'buy' | 'sell' | 'neutral' | null; conf: number | null }> = {};
      (signals || []).forEach((s: any) => {
        const key = s.symbol.toUpperCase();
        if (!latestBySymbol[key]) {
          latestBySymbol[key] = {
            type: s.signal_type ?? null,
            conf: s.confidence_score ?? null,
          };
        }
      });

      const dataWithSignals: PriceItem[] = priceData.map((p) => {
        const sig = latestBySymbol[p.symbol.toUpperCase()] ?? { type: null, conf: null };
        return {
          ...p,
          latestSignalType: sig.type,
          latestSignalConfidence: sig.conf,
        };
      });

      const bySymbol: Record<string, PriceItem> = {};
      for (const p of dataWithSignals) {
        bySymbol[p.symbol.toUpperCase()] = p;
      }
      setPrices(bySymbol);
    } catch (e) {
      console.error('Failed to load watchlist symbols', e);
    } finally {
      setLoading(false);
    }
  }

  const handleRemoveSymbol = async (symbol: string) => {
    if (!activeWatchlistId) return;
    
    try {
      const response = await fetch(
        `/api/watchlists/${activeWatchlistId}/symbols?symbol=${encodeURIComponent(symbol)}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setItems(items.filter((item) => item.symbol !== symbol));
        // Refresh watchlist counts
        if ((window as any).__refreshWatchlists) {
          (window as any).__refreshWatchlists();
        }
      }
    } catch (error) {
      console.error('Failed to remove symbol:', error);
    }
  };

  const handleTogglePin = async (symbol: string, currentPinStatus: boolean) => {
    if (!activeWatchlistId) return;

    console.log('[Frontend] Toggle pin request:', {
      activeWatchlistId,
      symbol,
      currentPinStatus,
      newPinStatus: !currentPinStatus
    });

    try {
      const url = `/api/watchlists/${activeWatchlistId}/symbols`;
      const body = { symbol, is_pinned: !currentPinStatus };
      console.log('[Frontend] Fetch URL:', url, 'Body:', body);

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        // Update local state
        setItems(
          items.map((item) =>
            item.symbol === symbol ? { ...item, is_pinned: !currentPinStatus } : item
          )
        );
        
        // Notify to reload dashboard watchlist preview
        // Broadcast event for dashboard to listen to
        window.dispatchEvent(new CustomEvent('watchlist-pin-changed', {
          detail: { symbol, isPinned: !currentPinStatus }
        }));
      } else {
        console.error('Failed to toggle pin:', await response.text());
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.symbol === active.id);
    const newIndex = items.findIndex((item) => item.symbol === over.id);

    const newItems = arrayMove(items, oldIndex, newIndex);
    
    // Update local state immediately for smooth UX
    setItems(newItems);

    // Persist to backend
    if (activeWatchlistId) {
      try {
        const reorderedSymbols = newItems.map((item, index) => ({
          symbol: item.symbol,
          order_index: index,
        }));

        await fetch(`/api/watchlists/${activeWatchlistId}/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: reorderedSymbols }),
        });
      } catch (error) {
        console.error('Failed to reorder symbols:', error);
        // Revert on error
        setItems(items);
      }
    }
  };

  const count = items.length;

  return (
    <div>
      {/* Watchlist Switcher */}
      <div className="mb-6">
        <WatchlistSwitcher
          activeWatchlistId={activeWatchlistId}
          onWatchlistChange={setActiveWatchlistId}
          onCreateNew={() => {
            setModalMode('create');
            setModalOpen(true);
          }}
        />
      </div>

      {/* Management Modal */}
      <WatchlistManagementModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={modalMode}
        watchlistId={activeWatchlistId || undefined}
        onSuccess={() => {
          // Refresh watchlists in switcher
          if ((window as any).__refreshWatchlists) {
            (window as any).__refreshWatchlists();
          }

          // After delete, clear active list so user explicitly chooses another
          if (modalMode === 'delete') {
            setActiveWatchlistId(null);
            setItems([]);
          } else if (modalMode === 'rename') {
            // For rename, just reload symbols for the same list
            loadWatchlistSymbols();
          }
        }}
      />

      {!activeWatchlistId ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-200 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Create or select a watchlist to get started
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm font-semibold text-gray-900">Symbols ({count || 0})</p>
            <AddSymbolButton defaultWatchlistId={activeWatchlistId} />
          </div>

          {/* Column headers - adjusted to account for action buttons */}
          <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            <div className="w-4 flex-shrink-0"></div> {/* Drag handle space */}
            <div className="w-4 flex-shrink-0"></div> {/* Pin button space */}
            <div className="flex-1 flex items-center gap-6 px-4">
              <div className="w-32 min-w-[8rem] flex-shrink-0">Symbol</div>
              <div className="w-24 flex-shrink-0">Last</div>
              <div className="w-20 flex-shrink-0">% Change</div>
              <div className="w-32 flex-shrink-0">Signal</div>
              <div className="w-24 flex-shrink-0 text-right">Volume</div>
              <div className="flex-1 text-center">Chart</div>
              <div className="w-32 flex-shrink-0 text-right">Updated</div>
            </div>
            <div className="w-4 flex-shrink-0"></div> {/* Remove button space */}
          </div>

          {loading ? (
            <div className="space-y-3 mt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-11 rounded-xl border border-gray-100 bg-gray-50 animate-pulse"
                />
              ))}
            </div>
          ) : count === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-gray-200 p-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No symbols yet — add one to get started.
              </p>
              <AddSymbolButton defaultWatchlistId={activeWatchlistId} />
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((item) => item.symbol)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3 mt-2">
                  {items.map((item) => (
                    <SortableWatchlistItem
                      key={item.symbol}
                      item={item}
                      prices={prices}
                      onRemove={handleRemoveSymbol}
                      onTogglePin={handleTogglePin}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </>
      )}
    </div>
  );
}

function SortableWatchlistItem({
  item,
  prices,
  onRemove,
  onTogglePin,
}: {
  item: WatchlistSymbol;
  prices: Record<string, PriceItem>;
  onRemove: (symbol: string) => void;
  onTogglePin: (symbol: string, currentStatus: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.symbol });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const p = prices[item.symbol.toUpperCase()];

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-1 hover:bg-gray-100 rounded cursor-grab active:cursor-grabbing flex-shrink-0"
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4 text-gray-400" />
      </button>

      {/* Pin Button */}
      <button
        onClick={() => onTogglePin(item.symbol, item.is_pinned)}
        className="p-1 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
        title={item.is_pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
      >
        <Star
          className={`w-4 h-4 transition-colors ${
            item.is_pinned
              ? 'text-yellow-500 fill-yellow-500'
              : 'text-gray-400 hover:text-yellow-500'
          }`}
        />
      </button>

      {/* Asset Card */}
      <div className="flex-1">
        <AssetCard
          symbol={item.symbol.toUpperCase()}
          name={undefined}
          price={p?.price ?? null}
          changePct={p?.changePct ?? null}
          volume={p?.volume ?? null}
          latestSignalType={p?.latestSignalType ?? null}
          latestSignalConfidence={p?.latestSignalConfidence ?? null}
          sparkline={p?.sparkline ?? null}
          sentiment={null}
          lastUpdated={p?.updatedAt ?? null}
          proRequired={false}
        />
      </div>

      {/* Remove Button */}
      <button
        onClick={() => onRemove(item.symbol)}
        className="p-1 hover:bg-red-50 rounded transition-colors flex-shrink-0"
        title="Remove from watchlist"
      >
        <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-600" />
      </button>
    </div>
  );
}
