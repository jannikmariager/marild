'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from '@/components/billing/upgrade-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Sparkles,
  BarChart3,
  AlertTriangle,
  MessageSquare,
  HelpCircle,
  Lock,
  Clock,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';

interface MarketSummaryData {
  headline: string;
  market_trend: string[];
  volatility_risk: string[];
  sentiment_signals: string[];
  insight: string;
  summary_label: 'bullish' | 'neutral' | 'bearish';
  as_of: string;
  access: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export default function AiMarketSummaryCard() {
  const [data, setData] = useState<MarketSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSummary();
  }, []);

  async function fetchSummary() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai-market-summary/latest');
      const result = await response.json();

      // Handle 404 or NO_DATA error
      if (response.status === 404 || result.error === 'NO_DATA') {
        setError('No AI market summary available yet. Check back later.');
        setIsLoading(false);
        return;
      }

      // Handle other errors (except 403 which is handled in data.access)
      if (!response.ok && response.status !== 403) {
        throw new Error(result.message || `Failed to fetch: ${response.status}`);
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching AI market summary:', err);
      setError(err.message || 'Failed to load market summary');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState error={error} />;
  }

  // If API indicates the feature is locked (FREE user), show locked teaser state
  if (data.access?.is_locked) {
    return <LockedState />;
  }

  const getBadgeColor = (label: string) => {
    switch (label) {
      case 'bullish':
        return 'bg-[#0AAE84]/10 text-[#0AAE84] border-[#0AAE84]/20';
      case 'bearish':
        return 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20';
      default:
        return 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/20';
    }
  };

  const getBulletColor = (text: string) => {
    const lower = text.toLowerCase();
    
    // Bullish keywords
    if (/strong|improving|positive|leading|recovering|rising/i.test(lower)) {
      return '#22C55E';
    }
    
    // Bearish keywords
    if (/weak|lagging|declining|risk|uncertain|falling/i.test(lower)) {
      return '#EF4444';
    }
    
    // Neutral
    return '#EAB308';
  };

  const timeAgo = (dateString: string) => {
    const now = new Date();
    const then = new Date(dateString);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} minutes ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  };

  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#0AAE84]/10">
              <Sparkles className="h-5 w-5 text-[#0AAE84]" />
            </div>
            <h2 className="text-lg font-semibold text-[#111827]">Market Summary</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase border ${getBadgeColor(data.summary_label)}`}>
              {data.summary_label}
            </span>
            <InfoButton />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline */}
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-1 leading-snug">{data.headline}</h3>
          <p className="text-sm text-[#374151]">Based on AI analysis of 12+ indicators</p>
        </div>

        {/* Market Trend */}
        <SummarySection
          title="Market Trend"
          icon={<BarChart3 className="h-4 w-4" />}
          items={data.market_trend || []}
          getBulletColor={getBulletColor}
        />

        {/* Volatility & Risk */}
        <SummarySection
          title="Volatility & Risk"
          icon={<AlertTriangle className="h-4 w-4" />}
          items={data.volatility_risk || []}
          getBulletColor={getBulletColor}
        />

        {/* Sentiment Signals */}
        <SummarySection
          title="Sentiment Signals"
          icon={<MessageSquare className="h-4 w-4" />}
          items={data.sentiment_signals || []}
          getBulletColor={getBulletColor}
        />

        {/* AI Insight */}
        <div className="p-4 rounded-lg bg-[#0AAE84]/8 border border-[#0AAE84]/20">
          <p className="text-sm font-semibold text-[#0AAE84]">💡 AI Insight: {data.insight}</p>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-[#6B7280]" />
          <span className="text-xs text-[#6B7280]">Updated {timeAgo(data.as_of)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SummarySection({
  title,
  icon,
  items,
  getBulletColor,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  getBulletColor: (text: string) => string;
}) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[#374151]">
        {icon}
        <h4 className="font-semibold text-sm">{title}</h4>
      </div>
      <ul className="space-y-1.5 ml-6">
        {safeItems.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
              style={{ backgroundColor: getBulletColor(item) }}
            />
            <span className="text-sm text-[#374151]">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="p-1 hover:bg-[#E5E7EB] rounded-full transition-colors"
          aria-label="How AI generates this summary"
        >
          <HelpCircle className="h-5 w-5 text-[#374151]" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-white border-[#E5E7EB]">
        <DialogHeader>
          <DialogTitle className="text-[#111827]">How is this AI Summary generated?</DialogTitle>
        </DialogHeader>
        
        <Separator className="bg-[#E5E7EB]" />
        
        <div className="space-y-4 text-[#111827]">
          <p className="text-sm text-[#374151]">
            Marild analyzes 12+ real-time indicators, including:
          </p>

          <ul className="space-y-2 text-sm text-[#374151]">
            <li className="flex items-start gap-2">
              <span className="text-[#0AAE84]">•</span>
              <span>Market structure & momentum</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0AAE84]">•</span>
              <span>Volatility regime (VIX, realized/IV spread)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0AAE84]">•</span>
              <span>Sector rotation & breadth</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0AAE84]">•</span>
              <span>Institutional flow signals</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0AAE84]">•</span>
              <span>Macro catalysts & news sentiment</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0AAE84]">•</span>
              <span>High-level technical factors</span>
            </li>
          </ul>

          <Separator className="bg-[#E5E7EB]" />

          <div className="space-y-2">
            <p className="text-sm font-semibold text-[#111827]">The AI model synthesizes these signals into:</p>
            <ul className="space-y-1 text-sm text-[#374151] ml-4">
              <li>- Headline summary</li>
              <li>- Trend assessment</li>
              <li>- Risk/volatility view</li>
              <li>- Sentiment breakdown</li>
              <li>- A final actionable insight</li>
            </ul>
          </div>

          <Separator className="bg-[#E5E7EB]" />

          <p className="text-xs text-[#6B7280] italic">
            This summary updates throughout the trading day and reflects hypothetical analysis only.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingState() {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-6 w-40" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  );
}

function ErrorState({ error }: { error: string | null }) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#0AAE84]/10">
            <Sparkles className="h-5 w-5 text-[#0AAE84]" />
          </div>
          <h2 className="text-lg font-semibold text-[#111827]">Market Summary</h2>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 p-4 bg-[#EF4444]/10 rounded-lg border border-[#EF4444]/20">
          <AlertCircle className="h-5 w-5 text-[#EF4444]" />
          <p className="text-sm text-[#EF4444]">{error || 'Failed to load AI market summary'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LockedState() {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#0AAE84]/10">
              <Sparkles className="h-5 w-5 text-[#0AAE84]" />
            </div>
            <h2 className="text-lg font-semibold text-[#111827]">Market Summary</h2>
          </div>
          <InfoButton />
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Blurred preview */}
          <div className="blur-sm pointer-events-none opacity-50 space-y-3">
            <h3 className="text-xl font-bold text-[#111827]">Market consolidates as volatility stabilizes...</h3>
            <div className="space-y-2">
              <div className="h-4 bg-[#E5E7EB] rounded w-3/4" />
              <div className="h-4 bg-[#E5E7EB] rounded w-2/3" />
              <div className="h-4 bg-[#E5E7EB] rounded w-full" />
            </div>
          </div>

          {/* Lock overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
            <Lock className="h-10 w-10 text-[#374151] mb-2" />
            <h3 className="text-base font-semibold text-[#111827] mb-1 text-center">
              Unlock full AI Insights
            </h3>
            <UpgradeButton
              size="sm"
              className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white mt-2"
            >
              Upgrade to PRO
            </UpgradeButton>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
