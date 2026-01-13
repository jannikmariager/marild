'use client';

import { Topbar } from '@/components/layout/topbar';
import { MarketOverview } from '@/components/markets/MarketOverview';
import { AIMarketCommentary } from '@/components/markets/AIMarketCommentary';
import { SectorHeatmap } from '@/components/markets/SectorHeatmap';

export default function MarketsPage() {
  return (
    <div>
      <Topbar title="Markets" />
      <div className="p-6 space-y-6">
        {/* Market Overview KPI Chips */}
        <MarketOverview />

        {/* AI Market Commentary */}
        <AIMarketCommentary />

        {/* Market structure & sectors */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sector Heatmap - Takes 2 columns on large screens */}
          <div className="lg:col-span-2">
            <SectorHeatmap />
          </div>

          {/* Reserved for future AI market modules */}
          <div />
        </div>
      </div>
    </div>
  );
}
