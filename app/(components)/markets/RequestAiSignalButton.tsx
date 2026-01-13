'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUser } from '@/components/providers/user-provider';

interface RequestAiSignalButtonProps {
  symbol: string;
  timeframe?: string;
}

export function RequestAiSignalButton({ symbol, timeframe = '1D' }: RequestAiSignalButtonProps) {
  const router = useRouter();
  const user = useUser();

  const handleClick = useCallback(() => {
    const isPro = user?.subscription_tier === 'pro';

    if (!isPro) {
      router.push('/upgrade?source=request-signal');
      return;
    }

    const params = new URLSearchParams({
      symbol,
      timeframe,
      source: 'markets',
    });

    router.push(`/trade-signal?${params.toString()}`);
  }, [router, symbol, timeframe, user]);

  return (
    <Button
      className="w-full mt-4 h-12 text-lg font-semibold"
      onClick={handleClick}
      type="button"
    >
      Request AI Signal
    </Button>
  );
}
