'use client';

import { useEffect, useState } from 'react';
import { AssetCard } from '@/app/(components)/asset-card';
import { AddSymbolButton } from '@/components/watchlist/add-symbol-button';
import { createClient } from '@/lib/supabaseBrowser';

interface WatchlistRow {
  symbol: string;
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

const DISPLAY_SIGNAL_STATUSES = ['active', 'watchlist', 'filled', 'tp_hit', 'sl_hit', 'timed_out'] as const;

export function WatchlistAssetList() {
  const [items, setItems] = useState<WatchlistRow[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceItem>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
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

        const { data: watchlist, error } = await supabase
          .from('user_watchlist')
          .select('symbol, added_at')
          .eq('user_id', user.id)
          .order('added_at', { ascending: false });

        if (error || !watchlist || watchlist.length === 0) {
          setItems([]);
          setLoading(false);
          return;
        }

        setItems(watchlist as WatchlistRow[]);

        const symbols = watchlist.map((w) => w.symbol.toUpperCase());

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
          .in('status', DISPLAY_SIGNAL_STATUSES)
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

        const data: PriceItem[] = priceData.map((p) => {
          const sig = latestBySymbol[p.symbol.toUpperCase()] ?? { type: null, conf: null };
          return {
            ...p,
            latestSignalType: sig.type,
            latestSignalConfidence: sig.conf,
          };
        });

        const bySymbol: Record<string, PriceItem> = {};
        for (const p of data) {
          bySymbol[p.symbol.toUpperCase()] = p;
        }
        setPrices(bySymbol);
      } catch (e) {
        console.error('Failed to load watchlist prices', e);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const count = items.length;

  // Top row: label + Add Symbol (kept outside grid, matches spec)
  return (
    <div>
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-gray-900">Your Watchlist ({count || 0})</p>
        <AddSymbolButton />
      </div>

      {/* Column headers */}
      <div className="mt-4 flex items-center gap-6 text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4">
        <div className="w-32 min-w-[8rem] flex-shrink-0">Symbol</div>
        <div className="w-24 flex-shrink-0">Last</div>
        <div className="w-20 flex-shrink-0">% Change</div>
        <div className="w-32 flex-shrink-0">Signal</div>
        <div className="w-24 flex-shrink-0 text-right">Volume</div>
        <div className="flex-1 text-center">Chart</div>
        <div className="w-32 flex-shrink-0 text-right">Updated</div>
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
          <AddSymbolButton />
        </div>
      ) : (
        <div className="space-y-3 mt-2">
          {items.map((item) => {
            const p = prices[item.symbol.toUpperCase()];
            return (
              <AssetCard
                key={item.symbol}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
