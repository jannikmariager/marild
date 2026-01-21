import { createClient } from '@/lib/supabaseServer';
import ProLockedCard from '@/components/feed/ProLockedCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { hasProAccess } from '@/lib/subscription/devOverride';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SignalStyleSelector } from '@/components/tradesignal/signal-style-selector';
import type { SignalStyle } from '@/lib/engine/v74_presets';

interface StockDetailAiSectionProps {
  symbol: string;
  isApproved: boolean;
}

const DISPLAY_SIGNAL_STATUSES = ['active', 'watchlist', 'filled', 'tp_hit', 'sl_hit', 'timed_out'] as const;

export async function StockDetailAiSection({ symbol, isApproved }: StockDetailAiSectionProps) {
  const supabase = await createClient();

  console.log('[StockDetailAiSection] calling supabase.auth.getUser()');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.warn('[StockDetailAiSection] getUser error', error);
  }

  let hasProAccessFlag = false;
  let signalStyle: SignalStyle = 'balanced';

  if (user) {
    const userId = user.id;
    const { data: subStatus } = await supabase
      .from('subscription_status')
      .select('tier')
      .eq('user_id', userId)
      .maybeSingle();

    const isPro = subStatus?.tier === 'pro';
    // Use standard dev override logic so DEV_FORCE_PRO works
    hasProAccessFlag = hasProAccess(isPro);

    // Load saved signal_style preference from user_profile (optional)
    const { data: profileStyle, error: styleError } = await supabase
      .from('user_profile')
      .select('signal_style')
      .eq('user_id', userId)
      .maybeSingle();

    if (!styleError) {
      const value = (profileStyle as any)?.signal_style as string | null;
      if (value === 'conservative' || value === 'balanced' || value === 'precision') {
        signalStyle = value;
      }
    }
  }

  // Fetch latest AI signal for this symbol (no OpenAI calls)
  let latestSignal: any = null;

  if (user && isApproved) {
    const { data: signals } = await supabase
      .from('ai_signals')
      .select('*')
      .eq('symbol', symbol)
      .in('status', DISPLAY_SIGNAL_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1);

    latestSignal = signals?.[0] || null;
  }

  const entryPrice = typeof latestSignal?.entry_price === 'number' ? latestSignal.entry_price : null;
  const tpPrice = typeof latestSignal?.take_profit_1 === 'number' ? latestSignal.take_profit_1 : null;
  const slPrice = typeof latestSignal?.stop_loss === 'number' ? latestSignal.stop_loss : null;

  let rrLabel: string | null = null;
  if (entryPrice != null && tpPrice != null && slPrice != null) {
    const risk = Math.abs(entryPrice - slPrice);
    const reward = Math.abs(tpPrice - entryPrice);
    if (risk > 0 && reward > 0) {
      const rr = reward / risk;
      rrLabel = `${rr.toFixed(2)} : 1`;
    }
  }

  const hasLevels = entryPrice != null || tpPrice != null || slPrice != null || rrLabel;

  const aiContent = (
    <div className="space-y-4 mt-6">
      <Card className="border-gray-200">
        <CardHeader className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Latest AI Signal</CardTitle>
            {latestSignal?.updated_at && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                Updated {new Date(latestSignal.updated_at).toLocaleString()}
              </p>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500 hover:bg-gray-50"
                aria-label="What is Latest AI Signal?"
              >
                ?
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p>
                Snapshot of the most recent AI TradeSignal generated for this symbol, including
                direction, confidence and timeframe.
              </p>
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent>
          {!isApproved ? (
            <p className="text-sm text-gray-500">
              AI signals are not available for {symbol}. This ticker is not part of our approved trading universe.
            </p>
          ) : latestSignal ? (
            <div className="space-y-2 text-sm text-gray-800">
              <div className="space-y-1">
                <p>
                  <span className="font-semibold">Direction:</span> {latestSignal.signal_type || latestSignal.action}
                </p>
                {latestSignal.confidence && (
                  <p>
                    <span className="font-semibold">Confidence:</span>{' '}
                    {Math.round(latestSignal.confidence * 100)}%
                  </p>
                )}
                {latestSignal.timeframe && (
                  <p>
                    <span className="font-semibold">Timeframe:</span> {latestSignal.timeframe}
                  </p>
                )}
              </div>

              {hasLevels ? (
                <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                  {entryPrice != null && (
                    <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 border border-emerald-100">
                      Entry {entryPrice.toFixed(2)}
                    </span>
                  )}
                  {tpPrice != null && (
                    <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 border border-emerald-100">
                      TP {tpPrice.toFixed(2)}
                    </span>
                  )}
                  {slPrice != null && (
                    <span className="rounded-full bg-red-50 text-red-700 px-2 py-0.5 border border-red-100">
                      SL {slPrice.toFixed(2)}
                    </span>
                  )}
                  {rrLabel && (
                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 border border-slate-200">
                      R/R {rrLabel}
                    </span>
                  )}
                </div>
              ) : (
                <p className="pt-1 text-[11px] text-gray-400">
                  No trade levels (entry/TP/SL) available yet for this signal.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No AI signal available yet for {symbol}. Check back later for the latest AI-generated trade signals.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">AI Analysis</CardTitle>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500 hover:bg-gray-50"
                aria-label="What is AI Analysis?"
              >
                ?
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p>
                Short explanation of why the AI favours this direction, combining Smart Money structure,
                volume, sentiment and macro context into a human-readable summary.
              </p>
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent>
          {!isApproved ? (
            <p className="text-sm text-gray-500">
              AI analysis is not available for {symbol}. This ticker is not part of our approved trading universe.
            </p>
          ) : latestSignal?.reasoning ? (
            <p className="text-sm text-gray-800 whitespace-pre-line">{latestSignal.reasoning}</p>
          ) : (
            <p className="text-sm text-gray-500">No AI analysis available yet for {symbol}.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <ProLockedCard
      isLocked={!hasProAccessFlag}
      featureName={`AI Insights for ${symbol}`}
      description="Unlock AI signals, summaries and smart levels for this symbol."
    >
      {aiContent}
    </ProLockedCard>
  );
}
