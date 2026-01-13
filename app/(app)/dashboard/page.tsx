'use client';

import { Topbar } from '@/components/layout/topbar';
import { EngineStatusBanner } from '@/components/engine-status-banner';
import { MarketSummaryCard } from '@/components/dashboard/market-summary-card';
import { ActiveModelUniverseCard } from '@/components/dashboard/ActiveModelUniverseCard';
// Temporarily disable unstable AI insight cards until API/error handling is hardened
// import { AIHighlightsToday } from '@/components/home/AIHighlightsToday';
import { PerformancePreviewCard } from '@/components/performance/PerformancePreviewCard';
import { PerformanceUniverseCard } from '@/components/performance/PerformanceUniverseCard';
import { TopAiTradesCard } from '@/components/dashboard/TopAiTradesCard';
import { MarketCorrectionRiskCard } from '@/components/dashboard/MarketCorrectionRiskCard';
import { LatestNewsList } from '@/components/dashboard/latest-news-list';
import { useSignalNotifications } from '@/hooks/useSignalNotifications';

// AI Feed Components
import AiMarketSummaryCard from '@/components/feed/AiMarketSummaryCard';
// import QuickActionsRow from '@/components/feed/QuickActionsRowUpgraded';
// import TrendingSignalsCard from '@/components/feed/TrendingSignalsCard';
// import SectorStrengthCard from '@/components/feed/SectorStrengthCard';

const SHOW_QUICK_ACTIONS = false;

export default function DashboardPage() {
  // Enable signal notifications
  useSignalNotifications();

  return (
    <div>
      <Topbar title="Dashboard" />
      <div className="p-6">
        {/* Engine Status Banner */}
        <EngineStatusBanner />

        {/* Top Insights Cards - 2 column layout on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* 1. Market Correction Risk (PRO) */}
          <MarketCorrectionRiskCard />
          
          {/* 2. AI Market Summary (PRO) */}
          <AiMarketSummaryCard />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* 3. Approved Performance Tickers (PRO) */}
            {SHOW_QUICK_ACTIONS ? null : <PerformanceUniverseCard />}

            {/* 4. If you followed recent signals (Performance Preview, PRO) */}
            <PerformancePreviewCard />
            
            {/* 5. Active Model Universe */}
            <ActiveModelUniverseCard />
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Latest News (FREE) */}
            <LatestNewsList />

            {/* Top AI Trades */}
            <TopAiTradesCard />
          </div>
        </div>
      </div>
    </div>
  );
}
