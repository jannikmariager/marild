'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';

export default function SignalErrorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const symbol = searchParams?.get('symbol') ?? null;
  const reason = searchParams?.get('reason') ?? null;

  const message = (() => {
    if (reason === 'missing_symbol') {
      return 'Symbol is required to generate an AI signal.';
    }
    return 'We could not generate an AI TradeSignal for this symbol. Please try again later.';
  })();

  return (
    <div>
      <Topbar title="TradeSignal Error" />
      <div className="p-6 flex flex-col items-center justify-center space-y-4 max-w-xl mx-auto text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground">
          {message}
          {symbol && ` (Symbol: ${symbol})`}
        </p>
        <div className="flex gap-3 mt-2">
          <Button variant="outline" onClick={() => router.back()}>
            Go Back
          </Button>
          <Button onClick={() => router.push('/tradesignals')}>
            View All Signals
          </Button>
        </div>
      </div>
    </div>
  );
}
