'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';

export function PerformanceInfoModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Info className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>How is performance calculated?</DialogTitle>
          <DialogDescription>
            Understanding the Marild Performance Model
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p>
            Marild calculates hypothetical performance using a standardized model portfolio.
          </p>
          
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>
              <strong>Starting balance:</strong> $100,000 (virtual)
            </li>
            <li>
              <strong>Position size:</strong> 5% of portfolio per signal
            </li>
            <li>
              <strong>Entry price:</strong> Close price at the moment the signal was generated
            </li>
            <li>
              <strong>Exit rule:</strong> The trade closes when the next opposite signal appears.
            </li>
            <li>
              <strong>Fallback exit:</strong> If no opposite signal appears within 10 candles, 
              the trade exits at the close of that candle.
            </li>
            <li>
              <strong>Take-profit:</strong> TP is <em>not</em> used for portfolio performance, 
              but we track how often TP was hit (TP Hit Rate).
            </li>
            <li>
              <strong>Benchmark:</strong> Performance is compared against SPY or QQQ using the 
              same starting value.
            </li>
          </ul>

          <p className="text-muted-foreground pt-2">
            These rules keep results consistent, transparent, and easy to understand. 
            Performance is hypothetical and not financial advice.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
