import QuickActionsRowUpgraded from '@/components/feed/QuickActionsRowUpgraded';
import { MarketCorrectionRiskCard } from '@/components/dashboard/MarketCorrectionRiskCard';
import AiMarketSummaryCard from '@/components/feed/AiMarketSummaryCard';
import { AIHighlightsToday } from '@/components/home/AIHighlightsToday';
import TrendingSignalsCard from '@/components/feed/TrendingSignalsCard';
import SectorStrengthCard from '@/components/feed/SectorStrengthCard';
import NewsSentiment from '@/components/insights/NewsSentiment';
import { LatestNewsList } from '@/components/dashboard/latest-news-list';

export default function InsightsPage() {
  return (
    <div className="container max-w-screen-xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Insights</h1>
        <p className="text-gray-600">Comprehensive AI-powered market intelligence hub</p>
      </div>

      <div className="space-y-6">
        {/* 1. Quick AI Actions - 15 actions, 3-column layout */}
        <QuickActionsRowUpgraded />

        {/* 2. Market Correction Risk - AI-powered with sparkline + key drivers + breakdown modal */}
        <MarketCorrectionRiskCard />

        {/* 3. AI Market Summary - 12+ indicators, trend/volatility/sentiment blocks */}
        <AiMarketSummaryCard />

        {/* 4. AI Highlights Today - AI Sentiment, Strongest Sector, Weakest Sector */}
        <AIHighlightsToday />

        {/* 5. Trending AI Signals - AAPL, TSLA, etc. sorted by confidence */}
        <TrendingSignalsCard />

        {/* 6. Sector Strength - AI-evaluated sector performance */}
        <SectorStrengthCard />

        {/* 7. News Sentiment Analysis - bullish/neutral/bearish gauge + categorized news list */}
        <NewsSentiment />

        {/* 8. Latest News - AI mixed with sentiment tagging + last updated */}
        <LatestNewsList />
      </div>
    </div>
  );
}
