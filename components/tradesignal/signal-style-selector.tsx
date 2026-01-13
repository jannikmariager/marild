'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Lock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { SignalStyle } from '@/lib/engine/v74_presets';
import { setUserSignalStyle } from '@/app/actions/signalStyleActions';

interface SignalStyleSelectorProps {
  initialStyle: SignalStyle;
  isPro: boolean; // PRO access only
}

interface ModeProps {
  id: SignalStyle;
  title: string;
  desc: string;
  locked?: boolean;
  selected: boolean;
  onClick: () => void;
}

function ModeCard({ id, title, desc, locked, selected, onClick }: ModeProps) {
  return (
    <Card
      role="button"
      aria-pressed={selected}
      aria-label={title}
      className={cn(
        'p-4 cursor-pointer border transition-colors flex gap-3 items-start',
        selected
          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-500'
          : 'border-slate-200 hover:border-emerald-400 dark:border-slate-800 dark:hover:border-emerald-500'
      )}
      onClick={onClick}
    >
      {locked ? (
        <Lock className="mt-1 h-4 w-4 text-slate-400" />
      ) : selected ? (
        <CheckCircle className="mt-1 h-4 w-4 text-emerald-500" />
      ) : (
        <div className="mt-1 h-4 w-4 rounded-full border border-slate-400" />
      )}
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{desc}</div>
        {id === 'balanced' && (
          <div className="mt-1 inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-600 dark:text-slate-300">
            Default
          </div>
        )}
      </div>
    </Card>
  );
}

export function SignalStyleSelector({ initialStyle, isPro }: SignalStyleSelectorProps) {
  const [style, setStyle] = useState<SignalStyle>(initialStyle);
  const [updating, setUpdating] = useState(false);
  const router = useRouter();

  async function choose(newStyle: SignalStyle) {
    if (updating) return;
    if (newStyle === style) return;

    if (newStyle === 'precision' && !isPro) {
      toast.error('Precision Mode is PRO only', {
        description: 'Upgrade to PRO to unlock high-conviction AI TradeSignals.',
      });
      return;
    }

    try {
      setUpdating(true);
      await setUserSignalStyle(newStyle);
      setStyle(newStyle);
      toast.success('Signal style updated', {
        description:
          newStyle === 'conservative'
            ? 'More setups with reduced drawdown bias.'
            : newStyle === 'precision'
            ? 'Fewer, higher-conviction setups enabled.'
            : 'Balanced mode active for optimal expectancy.',
      });
      // Refresh Stock Details page so AI sections pull the new style
      router.refresh();
    } catch (error) {
      console.error('[SignalStyleSelector] Failed to update style', error);
      toast.error('Failed to update signal style', {
        description: 'Please try again in a moment.',
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Signal Style</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Tune how aggressive the AI engine is when searching for setups.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ModeCard
          id="conservative"
          title="Conservative"
          desc="More setups, reduced drawdown bias."
          selected={style === 'conservative'}
          onClick={() => choose('conservative')}
        />

        <ModeCard
          id="balanced"
          title="Balanced"
          desc="Best mix of accuracy and stability."
          selected={style === 'balanced'}
          onClick={() => choose('balanced')}
        />

        <ModeCard
          id="precision"
          title="Precision"
          desc="Fewer setups, highest conviction only."
          locked={!isPro}
          selected={style === 'precision'}
          onClick={() => choose('precision')}
        />
      </div>
    </div>
  );
}
