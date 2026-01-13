'use client';

import { useState, useTransition } from 'react';
import { StrategyFlagRow, updateStrategyFlags } from './engineFlagsActions';
import { Card } from '@/components/ui/card';

interface Props {
  flags: StrategyFlagRow[];
}

export function EngineSettingsClient({ flags }: Props) {
  const [isPending, startTransition] = useTransition();
  const [localFlags, setLocalFlags] = useState<StrategyFlagRow[]>(flags);

  const handleToggle = (
    strategy: string,
    field: 'allow_capital_recycling' | 'allow_slot_release',
    value: boolean,
  ) => {
    // Optimistic local update so the checkbox reflects the change immediately
    setLocalFlags((prev) =>
      prev.map((row) =>
        row.strategy === strategy ? { ...row, [field]: value } as StrategyFlagRow : row,
      ),
    );
    startTransition(async () => {
      try {
        await updateStrategyFlags(strategy, { [field]: value });
      } catch (error) {
        console.error('[EngineSettingsClient] Failed to update flags', error);
        alert('Failed to update engine settings. See console for details.');
      }
    });
  };

  // Only show a single, generic engine block in the UI.
  // Under the hood, we bind this to the SWING row if available, otherwise the first row.
  const swingRow = localFlags.find((r) => r.strategy === 'SWING') ?? localFlags[0];

  if (!swingRow) {
    return null;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Live Engine Optimizations</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            These switches control experimental live trade optimizations. When enabled, the engine may close profitable
            stalled trades early to recycle capital or free a trade slot for a higher-quality opportunity. Backtests
            are not affected.
          </p>
        </div>

        <div className="space-y-4 mt-2">
          <div className="flex flex-col gap-1 border rounded-md p-3 bg-background/50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Live trade engine
                </div>
                <div className="text-xs text-muted-foreground">
                  Auto-trade portfolio using the current production engine.
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">Capital recycling</div>
                  <div className="text-muted-foreground">
                    When enabled, the engine may partially close profitable low-momentum trades to lock in profit and
                    free capital for other opportunities.
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={swingRow.allow_capital_recycling}
                  onChange={(e) => handleToggle(swingRow.strategy, 'allow_capital_recycling', e.target.checked)}
                  disabled={isPending}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">Slot-aware replacement</div>
                  <div className="text-muted-foreground">
                    When enabled, and only at max open positions, the engine may fully close the weakest stalled
                    profitable trade to free a slot for a stronger blocked signal.
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={swingRow.allow_slot_release}
                  onChange={(e) => handleToggle(swingRow.strategy, 'allow_slot_release', e.target.checked)}
                  disabled={isPending}
                />
              </div>
            </div>
          </div>
        </div>

        {isPending && (
          <div className="text-xs text-muted-foreground">Updating engine settings…</div>
        )}
      </Card>
    </div>
  );
}
