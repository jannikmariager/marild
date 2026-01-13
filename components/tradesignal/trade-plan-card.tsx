'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { EngineBadge } from './EngineBadge';

interface TradePlanCardProps {
  // ai_signals row – kept as any to avoid over-constraining the type here
  signal: any;
}

export function TradePlanCard({ signal }: TradePlanCardProps) {
  const direction = getDirection(signal?.signal_type);
  const statusLabel = getStatusLabel(signal?.status);
  const isAiTraded =
    signal?.source === 'performance_engine' && !!signal?.performance_trade_id;

  const entry = signal?.entry_price as number | undefined;
  const tp1 = signal?.take_profit_1 as number | undefined;
  const tp2 = signal?.take_profit_2 as number | undefined;
  const sl = signal?.stop_loss as number | undefined;

  const currentPrice =
    (signal?.current_price as number | undefined) ??
    (signal?.last_price as number | undefined);

  const progress =
    entry != null && tp1 != null && currentPrice != null
      ? calculateProgress({
          signalType: signal?.signal_type,
          entry,
          tp1,
          currentPrice,
        })
      : null;

  const hasRiskPercent =
    typeof signal?.risk_percent === 'number' && !isNaN(signal.risk_percent);

  return (
    <Card className="p-6 space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-semibold tracking-tight">
              {signal?.symbol}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                {signal?.timeframe?.toUpperCase?.()}
              </span>
            </h2>

            {/* Direction badge */}
            <Badge
              className={cn(
                'text-xs px-2.5 py-1',
                direction === 'LONG' && 'bg-emerald-500/10 text-emerald-600 border-emerald-500/40',
                direction === 'SHORT' && 'bg-red-500/10 text-red-600 border-red-500/40',
                direction === 'NEUTRAL' && 'bg-slate-200 text-slate-700 border-slate-300'
              )}
              variant="outline"
            >
              {getDirectionIcon(signal?.signal_type)}
              <span className="ml-1">{direction}</span>
            </Badge>

            {/* Confidence */}
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              title={
                'Signal Confidence\nConfidence reflects historical performance, market conditions, and signal alignment.\nHigher confidence does not guarantee profitability.'
              }
            >
              <span className="font-medium">Confidence:</span>
              <Badge variant="outline" className="font-mono text-xs">
                {Number(signal?.confidence_score ?? 0).toFixed(0)}%
              </Badge>
            </div>

            {/* Status */}
            <Badge variant="outline" className="text-xs">
              {statusLabel}
            </Badge>
            <EngineBadge
              engineStyle={signal?.engine_style}
              engineKey={signal?.engine_key ?? signal?.engine_version}
            />
          </div>
        </div>

        {/* Right badge: AI plan vs. AI traded */}
        <div className="flex flex-col items-start md:items-end gap-1 text-xs">
          <Badge
            variant="outline"
            className={cn(
              'text-[11px] px-2 py-1 border-dashed',
              isAiTraded
                ? 'border-emerald-500/60 bg-emerald-500/5 text-emerald-700'
                : 'border-slate-400/70 bg-slate-50 text-slate-700'
            )}
          >
            <span className="mr-1">🤖</span>
            {isAiTraded ? 'Traded by AI (Model Portfolio)' : 'AI Trade Plan'}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            Model-managed signal. Execution may differ from manual trading.
          </span>
        </div>
      </div>

      {/* BODY: Price ladder + plan */}
      <div className="grid md:grid-cols-[220px,1fr] gap-6">
        {/* PRICE LADDER */}
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Price Levels
          </div>
          <ol className="space-y-2 text-sm">
            {/* TP2 – informational only */}
            {tp2 != null && (
              <li
                className="flex items-center justify-between rounded-md border border-dashed border-emerald-300 bg-emerald-50/40 px-3 py-2 text-emerald-800"
                title={
                  'Extended Target (TP2)\nTP2 is a projected extension and not the primary execution target.\nThe AI manages trades primarily toward TP1.'
                }
              >
                <div className="flex flex-col">
                  <span className="text-xs font-semibold">TP2 (Extended)</span>
                  <span className="text-[11px] text-emerald-900/80">
                    TP2 is a projected extension and not the primary execution target.
                  </span>
                </div>
                <span className="font-mono text-sm">${tp2.toFixed(2)}</span>
              </li>
            )}

            {/* TP1 */}
            {tp1 != null && (
              <li className="flex items-center justify-between rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]">
                <span className="text-xs font-semibold">TP1 (Primary target)</span>
                <span className="font-mono text-sm">${tp1.toFixed(2)}</span>
              </li>
            )}

            {/* ENTRY */}
            {entry != null && (
              <li className="flex items-center justify-between rounded-md border border-sky-400 bg-sky-50 px-3 py-2 text-sky-900">
                <span className="text-xs font-semibold">ENTRY</span>
                <span className="font-mono text-sm">${entry.toFixed(2)}</span>
              </li>
            )}

            {/* SL */}
            {sl != null && (
              <li className="flex items-center justify-between rounded-md border border-red-400 bg-red-50 px-3 py-2 text-red-900">
                <span className="text-xs font-semibold">SL (Stop-loss)</span>
                <span className="font-mono text-sm">${sl.toFixed(2)}</span>
              </li>
            )}
          </ol>
        </div>

        <div className="space-y-4">
          {/* PROGRESS BAR – ENTRY → TP1 */}
          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {progress.raw < 0
                    ? 'Price below entry'
                    : progress.raw > 1
                    ? 'Beyond TP1'
                    : `Price is ${progress.percent.toFixed(0)}% of the way to TP1`}
                </span>
                {currentPrice != null && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Price: ${currentPrice.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${progress.clampedPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* AI TRADE PLAN BLOCK */}
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">🧠 AI Trade Plan</span>
              </div>
              <span
                className="inline-flex"
                title={
                  'AI Trade Plan\nThe model portfolio follows this plan exactly using strict risk and execution rules.\nDeviating from the plan may lead to different results.'
                }
              >
                <Info
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
              </span>
            </div>

            <div className="space-y-1 text-sm">
              {/* Risk */}
              <p>
                <span className="font-medium">Risk: </span>
                {hasRiskPercent ? (
                  <>
                    {Number(signal.risk_percent).toFixed(1)}% of capital{' '}
                    <span className="text-xs text-muted-foreground">
                      (model portfolio)
                    </span>
                  </>
                ) : (
                  <>
                    Defined by AI risk rules
                  </>
                )}
              </p>

              {/* Stop-loss */}
              {sl != null && (
                <p>
                  <span className="font-medium">Stop-loss: </span>
                  Fixed at SL&nbsp;
                  <span className="font-mono">${sl.toFixed(2)}</span>
                </p>
              )}

              {/* Primary target */}
              {tp1 != null && (
                <p>
                  <span className="font-medium">Primary target: </span>
                  TP1&nbsp;
                  <span className="font-mono">${tp1.toFixed(2)}</span>
                </p>
              )}
            </div>

            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  Management rules
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                  <li>Secure profits at TP1</li>
                  <li>Protect downside using the predefined stop-loss</li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  Discipline rules
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                  <li>Do not widen the stop-loss</li>
                  <li>Do not add to losing positions</li>
                </ul>
              </div>
            </div>
          </div>

          {/* CLOSED OUTCOME – requires P&L data; rendered only when present */}
          {renderOutcomeBlocks(signal)}

          {/* FOOTER DISCLAIMER */}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Results assume adherence to the AI trade plan. Manual execution may
            vary.
          </p>
        </div>
      </div>
    </Card>
  );
}

function getDirection(signalType: string | undefined): 'LONG' | 'SHORT' | 'NEUTRAL' {
  const t = signalType?.toLowerCase();
  if (t === 'buy' || t === 'bullish') return 'LONG';
  if (t === 'sell' || t === 'bearish') return 'SHORT';
  return 'NEUTRAL';
}

function getStatusLabel(status: string | undefined): 'Active' | 'Closed' | 'Expired' {
  const s = status?.toLowerCase();
  if (!s || s === 'active') return 'Active';
  if (s === 'tp_hit' || s === 'sl_hit' || s === 'timed_out' || s === 'closed')
    return 'Closed';
  return 'Expired';
}

function getDirectionIcon(signalType: string | undefined) {
  const t = signalType?.toLowerCase();
  if (t === 'buy' || t === 'bullish') {
    return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (t === 'sell' || t === 'bearish') {
    return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
  }
  return <Minus className="h-3.5 w-3.5 text-slate-500" />;
}

function calculateProgress({
  signalType,
  entry,
  tp1,
  currentPrice,
}: {
  signalType: string | undefined;
  entry: number;
  tp1: number;
  currentPrice: number;
}) {
  const isLong = (signalType ?? '').toLowerCase() === 'buy' ||
    (signalType ?? '').toLowerCase() === 'bullish';

  let raw: number;
  if (isLong) {
    raw = (currentPrice - entry) / (tp1 - entry);
  } else {
    // SHORT / bearish
    raw = (entry - currentPrice) / (entry - tp1);
  }

  const clamped = Math.max(0, Math.min(1, raw));

  return {
    raw,
    percent: raw * 100,
    clampedPercent: clamped * 100,
  };
}

function renderOutcomeBlocks(signal: any) {
  const status = signal?.status?.toLowerCase();
  const hasOutcomeData =
    signal?.exit_price != null &&
    signal?.pnl_usd != null &&
    signal?.pnl_pct != null;

  if (!status || !hasOutcomeData) return null;

  const isClosed =
    status === 'tp_hit' || status === 'sl_hit' || status === 'timed_out' || status === 'closed';
  if (!isClosed) return null;

  const exitReason = getExitReasonLabel(signal?.exit_reason ?? status);
  const exitPrice = Number(signal.exit_price) as number;
  const pnlUsd = Number(signal.pnl_usd) as number;
  const pnlPct = Number(signal.pnl_pct) as number;

  const pnlColor = pnlUsd >= 0 ? 'text-emerald-600' : 'text-red-600';
  const pnlPrefix = pnlUsd >= 0 ? '+' : '';

  return (
      <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
      {/* AI Outcome */}
      <div
        className="rounded-lg border bg-white p-3 space-y-1"
        title={
          'AI Outcome\nThis shows how the AI-managed portfolio executed the trade in real time.'
        }
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            AI Outcome
          </span>
          <Badge variant="outline" className="text-[11px]">
            🤖 AI-executed
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Exit: {exitReason}</p>
        <p className="text-xs text-muted-foreground">
          Exit price: <span className="font-mono">${exitPrice.toFixed(2)}</span>
        </p>
        <p className={cn('text-sm font-medium', pnlColor)}>
          {pnlPrefix}${Math.abs(pnlUsd).toFixed(2)} ({pnlPrefix}
          {Math.abs(pnlPct).toFixed(2)}%)
        </p>
      </div>

      {/* AI Reference Outcome */}
      <div
        className="rounded-lg border bg-white p-3 space-y-1"
        title={
          'Signal Plan Outcome\nThis represents the expected result if the trade plan was followed exactly.'
        }
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              AI Reference Outcome
            </span>
            <span className="text-[11px] text-muted-foreground">
              Model portfolio execution
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Exit: {exitReason}</p>
        <p className="text-xs text-muted-foreground">
          Exit price: <span className="font-mono">${exitPrice.toFixed(2)}</span>
        </p>
        <p className={cn('text-sm font-medium', pnlColor)}>
          {pnlPrefix}${Math.abs(pnlUsd).toFixed(2)} ({pnlPrefix}
          {Math.abs(pnlPct).toFixed(2)}%)
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Shown for transparency and benchmarking.
        </p>
      </div>
    </div>
  );
}

function getExitReasonLabel(reason: string | undefined): string {
  const r = reason?.toLowerCase() ?? '';
  if (r.includes('tp') || r === 'tp_hit') return 'TP';
  if (r.includes('sl') || r === 'sl_hit') return 'SL';
  if (r.includes('trail')) return 'Trailing';
  if (r.includes('eod') || r.includes('end_of_day')) return 'EOD';
  return reason || 'Closed';
}
