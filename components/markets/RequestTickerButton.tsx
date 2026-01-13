'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface RequestTickerButtonProps {
  symbol: string;
}

export function RequestTickerButton({ symbol }: RequestTickerButtonProps) {
  const router = useRouter();

  return (
    <Button
      onClick={() => router.push(`/request-ticker?symbol=${symbol}`)}
      variant="default"
      size="default"
      className="w-full"
    >
      Request This Ticker
    </Button>
  );
}
