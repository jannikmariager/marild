'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, RefreshCw, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface AICommentaryData {
  commentary: string;
  generated_at: string;
  access: {
    is_locked: boolean;
    has_pro_access: boolean;
  };
}

export function AIMarketCommentary() {
  const [data, setData] = useState<AICommentaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchCommentary();
  }, []);

  async function fetchCommentary() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/movers-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // User-friendly error messages
        if (response.status === 403) {
          throw new Error('This feature requires a PRO subscription');
        } else if (response.status === 500) {
          throw new Error('Market activity temporarily unavailable');
        } else {
          throw new Error(errorData.message || 'Unable to load commentary');
        }
      }

      const result = await response.json();
      setData(result);
    } catch (err: any) {
      console.error('Error fetching AI commentary:', err);
      setError(err.message || 'Unable to load commentary. Please try again later.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchCommentary();
  }

  if (isLoading && !data) {
    return (
      <Card className="rounded-xl border-gray-200 shadow-sm">
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-10/12" />
        </CardContent>
      </Card>
    );
  }

  if (data?.access?.is_locked) {
    return (
      <Card className="rounded-xl border-gray-200 shadow-sm relative overflow-hidden">
        {/* Blurred content */}
        <div className="opacity-40 blur-sm pointer-events-none">
          <CardContent>
            <p className="text-sm text-gray-600 leading-relaxed">
              Markets showing mixed signals with sector rotation continuing...
            </p>
          </CardContent>
        </div>

        {/* Lock overlay */}
        <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-xl flex items-center justify-center">
          <div className="text-center p-6">
            <Lock className="h-12 w-12 text-gray-700 mx-auto mb-3" />
            <p className="font-semibold mb-2 text-gray-900">Upgrade to PRO</p>
            <p className="text-gray-600 text-sm mb-3">Get real-time market insights</p>
            <Button asChild className="bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white">
              <Link href="/account">Upgrade to PRO</Link>
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="rounded-xl border-gray-200 shadow-sm">
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-gray-600 mb-3">{error || 'Failed to load commentary'}</p>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-gray-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
                <h2 className="text-lg font-semibold text-gray-900">Today’s Market Activity</h2>
         </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh commentary"
          >
            <RefreshCw className={`h-4 w-4 text-gray-600 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-700 leading-relaxed">{data.commentary}</p>
        <div className="mt-3 text-xs text-gray-500">
          Generated {new Date(data.generated_at).toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
}
