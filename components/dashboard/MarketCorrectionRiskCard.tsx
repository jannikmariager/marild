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
  AlertTriangle,
  HelpCircle,
  Lock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import Link from 'next/link';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { getRiskTrendColor } from '@/lib/utils/riskTrend';

interface CorrectionRiskFactor {
  factor_key: string;
  factor_label: string;
  status: 'supportive' | 'neutral' | 'elevated' | 'critical' | 'calm' | 'balanced' | 'mixed' | 'normal';
  score: number;
  reasoning: string;
}

interface KeyDriver {
  label: string;
  status: string;
}

interface CorrectionRiskData {
  risk_score: number;
  risk_label: 'low' | 'moderate' | 'high' | 'critical';
  summary: string;
  as_of_date: string;
  updated_at: string;
  trend?: number[];
  key_drivers?: KeyDriver[];
  factors: CorrectionRiskFactor[];
  access: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export function MarketCorrectionRiskCard() {
  const [data, setData] = useState<CorrectionRiskData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch immediately on mount
    fetchCorrectionRisk();

    // Set up 30-minute interval refresh
    const refreshInterval = setInterval(() => {
      fetchCorrectionRisk();
    }, 30 * 60 * 1000); // 30 minutes

    // Refresh when user returns to the page (visibility change)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCorrectionRisk();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  async function fetchCorrectionRisk() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/correction-risk/latest');

      const result = await response.json();

      // Handle 404 - no data available yet
      if (response.status === 404 || result.error === 'NO_DATA') {
        setError('No correction risk data available yet. Check back later.');
        setIsLoading(false);
        return;
      }

      // Handle authentication errors (401)
      if (response.status === 401 || result.message === 'Invalid JWT') {
        setError('Session expired. Please refresh the page to log in again.');
        setIsLoading(false);
        return;
      }

      // Handle other errors (except 403 which is handled in the data)
      if (!response.ok && response.status !== 403) {
        throw new Error(result.message || `Failed to fetch: ${response.status}`);
      }

      setData(result);
    } catch (err: any) {
      console.error('Error fetching correction risk:', err);
      setError(err.message || 'Failed to load risk data');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6 min-h-[400px] flex flex-col">
        <div className="flex justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-[#0AAE84] h-5 w-5" />
            <h2 className="text-lg font-semibold text-gray-900">Market Correction Risk</h2>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-12 w-32 mb-2" />
        <Skeleton className="h-[50px] w-full mb-4" />
        <div className="mb-4">
          <Skeleton className="h-5 w-32 mb-2" />
          <div className="space-y-1">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6 min-h-[400px] flex flex-col">
        <div className="flex justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-[#0AAE84] h-5 w-5" />
            <h2 className="text-lg font-semibold text-gray-900">Market Correction Risk</h2>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center flex-1">
          <AlertCircle className="h-12 w-12 text-gray-400 mb-3" />
          <p className="text-sm text-gray-600 mb-4">{error || 'Unable to load correction risk'}</p>
          <Button
            onClick={fetchCorrectionRisk}
            variant="outline"
            size="sm"
            className="text-[#0AAE84] border-[#0AAE84] hover:bg-[#0AAE84]/10"
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (data.access.is_locked) {
    return (
      <Card className="rounded-xl border border-gray-200 shadow-sm p-6 min-h-[400px] flex flex-col relative overflow-hidden">
        {/* Blurred content */}
        <div className="opacity-40 backdrop-blur-sm pointer-events-none">
          <div className="flex justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-[#0AAE84] h-5 w-5" />
              <h2 className="text-lg font-semibold text-gray-900">Market Correction Risk</h2>
            </div>
            <div className="px-3 py-1 rounded-full text-xs font-semibold uppercase bg-gray-100 text-gray-700">
              {data.risk_label}
            </div>
          </div>
          <div className="text-3xl font-bold text-gray-900 mb-2">
            {data.risk_score}/100
          </div>
          <div className="h-[50px] bg-gray-200 rounded mb-4" />
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-6 bg-gray-100 rounded" />
            ))}
          </div>
        </div>

        {/* Lock overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-xl">
          <div className="text-center">
            <Lock className="h-12 w-12 text-gray-700 mx-auto mb-3" />
            <p className="font-semibold mb-2 text-gray-900">Unlock Market Risk Insights</p>
            <UpgradeButton
              className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white"
            >
              Upgrade to PRO
            </UpgradeButton>
          </div>
        </div>
      </Card>
    );
  }

  const getRiskBadgeColor = (label: string) => {
    switch (label) {
      case 'low':
        return 'bg-[#0AAE84]/10 text-[#0AAE84]';
      case 'moderate':
        return 'bg-amber-50 text-amber-700';
      case 'high':
        return 'bg-red-50 text-red-700';
      case 'critical':
        return 'bg-red-100 text-red-800 font-semibold';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Get deterministic color based on risk trend direction
  const trendColor = getRiskTrendColor(data.trend || []);

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

  // Prepare sparkline data
  const sparklineData = (data.trend || []).map((value, index) => ({
    index,
    value,
  }));

  return (
    <Card className="rounded-xl border border-gray-200 shadow-sm p-6 min-h-[400px] flex flex-col">
      {/* HEADER */}
      <div className="flex justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-[#0AAE84] h-5 w-5" />
          <h2 className="text-lg font-semibold text-gray-900">Market Correction Risk</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${getRiskBadgeColor(data.risk_label)}`}>
            {data.risk_label}
          </span>
          <InfoButton data={data} />
        </div>
      </div>

      {/* SCORE */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-3xl font-bold text-gray-900">
          {data.risk_score}/100
        </div>
        <div className="text-sm font-medium text-gray-600 uppercase">
          {data.risk_label}
        </div>
      </div>

      {/* SPARKLINE TREND */}
      {sparklineData.length > 0 && (
        <div className="h-[50px] w-full mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={trendColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* KEY DRIVERS */}
      {data.key_drivers && data.key_drivers.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">Key Drivers Today</h3>
          <ul className="space-y-1">
            {data.key_drivers.slice(0, 5).map((driver, idx) => (
              <li key={idx} className="flex justify-between text-sm">
                <span className="text-gray-700">{driver.label}</span>
                <span className="text-gray-900 font-medium capitalize">
                  {driver.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* VIEW FULL BREAKDOWN */}
      <div className="mt-auto">
        <button
          onClick={() => document.getElementById('info-dialog-trigger')?.click()}
          className="text-sm text-[#0AAE84] font-medium hover:underline"
        >
          View full breakdown →
        </button>
      </div>

      {/* TIMESTAMP */}
      <div className="text-xs text-gray-500 mt-2">
        As of {data.as_of_date}
      </div>
    </Card>
  );
}

function InfoButton({ data }: { data?: CorrectionRiskData }) {
  const [isOpen, setIsOpen] = useState(false);
  const [modalData, setModalData] = useState<CorrectionRiskData | null>(data || null);
  const [isLoading, setIsLoading] = useState(false);

  async function fetchFreshData() {
    if (modalData) return; // Already have data
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/correction-risk/latest');
      const result = await response.json();
      setModalData(result);
    } catch (error) {
      console.error('Error fetching modal data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'supportive':
        return <TrendingUp className="h-4 w-4 text-[#22C55E]" />;
      case 'elevated':
      case 'critical':
        return <TrendingDown className="h-4 w-4 text-[#EF4444]" />;
      default:
        return <Minus className="h-4 w-4 text-[#6B7280]" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'supportive':
        return 'bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/20';
      case 'elevated':
        return 'bg-[#EAB308]/10 text-[#EAB308] border-[#EAB308]/20';
      case 'critical':
        return 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20';
      default:
        return 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/20';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          id="info-dialog-trigger"
          className="p-1 hover:bg-[#E5E7EB] rounded-full transition-colors"
          aria-label="View risk breakdown"
          onClick={() => {
            setIsOpen(true);
            fetchFreshData();
          }}
        >
          <HelpCircle className="h-5 w-5 text-[#374151]" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-white border-[#E5E7EB] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#111827]">Market Correction Risk Breakdown</DialogTitle>
        </DialogHeader>

        {isLoading || !modalData ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : modalData.access.is_locked ? (
          <div className="py-8 text-center">
            <Lock className="h-12 w-12 text-[#374151] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#111827] mb-2">
              Unlock Full Risk Breakdown
            </h3>
            <Button asChild className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white">
              <Link href="/account">Upgrade to PRO</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <Separator className="bg-[#E5E7EB]" />

            {/* Overall Score */}
            <div className="text-center">
              <span className={`text-5xl font-bold ${
                modalData.risk_score < 30 ? 'text-[#22C55E]' :
                modalData.risk_score < 60 ? 'text-[#EAB308]' :
                'text-[#EF4444]'
              }`}>
                {modalData.risk_score}/100
              </span>
              <p className="text-sm text-[#374151] mt-2">
                Updated {new Date(modalData.updated_at).toLocaleString()}
              </p>
            </div>

            <Separator className="bg-[#E5E7EB]" />

            {/* Factors */}
            <div className="space-y-4">
              <h4 className="font-semibold text-[#111827]">Risk Factors</h4>
              {modalData.factors.map((factor, index) => (
                <div key={factor.factor_key}>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">{getStatusIcon(factor.status)}</div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#111827]">{factor.factor_label}</span>
                        <span className={`text-xs px-2 py-1 rounded-full border ${getStatusColor(factor.status)}`}>
                          {factor.status}
                        </span>
                      </div>
                      <p className="text-sm text-[#374151]">{factor.reasoning}</p>
                    </div>
                  </div>
                  {index < modalData.factors.length - 1 && (
                    <Separator className="bg-[#E5E7EB] my-4" />
                  )}
                </div>
              ))}
            </div>

            <Separator className="bg-[#E5E7EB]" />

            {/* Disclaimer */}
            <p className="text-xs text-[#6B7280] italic">
              AI-generated risk assessment based on volatility, sentiment, macro, breadth, and technical indicators. Not financial advice.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
