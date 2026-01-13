import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TradeGateStatus, getTradeGateStatus } from '@/lib/trade-gate';

type LayoutVariant = 'default' | 'compact';

const TOOLTIP_COPY = 'Signals are gated until 10:00 ET to avoid premarket and opening auction noise.';

export function TradeGateBadge({ variant = 'default', className }: { variant?: LayoutVariant; className?: string }) {
  const [status, setStatus] = useState<TradeGateStatus>(() => getTradeGateStatus());

  useEffect(() => {
    const id = setInterval(() => setStatus(getTradeGateStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  const presentation = useMemo(() => mapStatusToPresentation(status), [status]);

  if (!presentation) return null;

  const content = (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border/70 bg-muted/40 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between',
        variant === 'compact' && 'px-3 py-2 text-xs',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
          <TooltipProvider>
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" aria-label="Trade gate info" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{TOOLTIP_COPY}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="text-muted-foreground">{presentation.message}</p>
      </div>
      <p className={cn('text-muted-foreground md:text-right', variant === 'compact' && 'text-[11px]')}>
        Current time (ET): {status.currentTimeET} · Window {status.gateStartET} - {status.gateEndET}
      </p>
    </div>
  );

  return content;
}

type Presentation = {
  label: string;
  message: string;
  badgeVariant: 'default' | 'secondary' | 'outline';
};

function mapStatusToPresentation(status: TradeGateStatus): Presentation | null {
  if (status.reason === 'MARKET_CLOSED_DAY' || status.reason === 'CLOSE_WINDOW_NO_TRADE') {
    return {
      label: 'Market closed',
      message: 'NYSE trading is closed right now. Signals resume next session after the opening auction settles.',
      badgeVariant: 'outline',
    };
  }

  if (status.reason === 'OPENING_WINDOW_NO_TRADE') {
    return {
      label: 'Stabilizing (9:30-10:00 ET)',
      message: 'We hold signals until 10:00 ET to filter out the opening auction volatility and spoofed liquidity.',
      badgeVariant: 'secondary',
    };
  }

  if (status.allowed) {
    return {
      label: 'Signals active',
      message: 'The NYSE gate is open. Signals, publishing, and executions are live until 15:55 ET.',
      badgeVariant: 'default',
    };
  }

  return null;
}
