'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { EngineStatusBanner } from '@/components/engine-status-banner';
import { SignalsTable } from '@/components/tradesignals/signals-table';
import { SignalsFilters } from '@/components/tradesignals/signals-filters';
import { FocusTickersCard } from '@/components/tradesignals/focus-tickers-card';
import ProLockedCard from '@/components/feed/ProLockedCard';
import { useUser } from '@/components/providers/user-provider';
import { useSignalsStore } from '@/lib/stores/signals-store';
import { TradeGateBadge } from '@/components/trade-gate-badge';

export default function TradeSignalsPage() {
  const user = useUser();
  const isPro = user?.subscription_tier === 'pro';
  const searchParams = useSearchParams();
  const { setFilters, filters } = useSignalsStore();
  
  // Read symbol from URL query params and set it in the store
  useEffect(() => {
    const symbol = searchParams?.get?.('symbol') ?? null;
    // Always update the filter when URL changes, even if already set
    if (symbol && symbol !== filters.symbol) {
      setFilters({ symbol });
    } else if (!symbol && filters.symbol) {
      // Clear symbol filter if URL doesn't have it
      setFilters({ symbol: undefined });
    }
  }, [searchParams, setFilters, filters.symbol]);

  return (
    <div>
      <Topbar title="TradeSignals" />
      <div className="p-6 space-y-6">
        {/* Engine Status Banner */}
        <EngineStatusBanner />
        <TradeGateBadge />
        <FocusTickersCard />

        <ProLockedCard
          isLocked={!isPro}
          featureName="TradeSignals"
          description="View the full list of live AI signals, confidence levels, and execution status."
        >
          {/* <SignalsFilters /> */}
          <SignalsTable />
        </ProLockedCard>
      </div>
    </div>
  );
}
