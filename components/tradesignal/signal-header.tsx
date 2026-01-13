'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getTradingStyleLabel, getTradingStyleEmoji, determineTradingStyle } from '@/types/tradesignal';
import { DaytraderEngineBadge } from '@/components/daytrader/DaytraderEngineBadge';
import { EngineBadge } from './EngineBadge';

interface SignalHeaderProps {
  signal: any;
}

export function SignalHeader({ signal }: SignalHeaderProps) {
  const signalColor = getSignalColor(signal.signal_type);
  const tradingStyle = signal.trading_style || determineTradingStyle(signal.timeframe);
  const tradingStyleLabel = getTradingStyleLabel(tradingStyle);
  const tradingStyleEmoji = getTradingStyleEmoji(tradingStyle);

  return (
    <Card
      className="p-6 bg-muted border-l-4"
      style={{ borderLeftColor: signalColor }}
    >
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {getSignalIcon(signal.signal_type)}
            <h2 className="text-2xl font-semibold">
              {signal.symbol} — {(signal.ai_decision || signal.signal_type).toUpperCase()}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {tradingStyleEmoji} {tradingStyleLabel}
              {' · '}
              {signal.timeframe.toUpperCase()}
            </p>
            {/* Show engine badge for DAYTRADER signals */}
            {signal.engine_type === 'DAYTRADER' && (
              <DaytraderEngineBadge 
                symbol={signal.symbol} 
                engineVersion={signal.engine_version} 
                size="sm" 
                showFullLabel={true}
              />
            )}
            {signal.engine_type !== 'DAYTRADER' && (
              <EngineBadge
                engineStyle={signal.engine_style}
                engineKey={signal.engine_key ?? signal.engine_version}
              />
            )}
          </div>
          
          {/* Show AI override if present */}
          {signal.ai_decision && signal.ai_decision !== signal.signal_type && (
            <Badge variant="outline" className="text-xs">
              🤖 AI Override: Rule-based was {signal.signal_type.toUpperCase()}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 md:flex md:flex-col gap-2 text-right">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Confidence</div>
            <Badge variant="outline" className="font-mono">
              {signal.confidence_score?.toFixed(0) || 0}%
            </Badge>
          </div>
          
          <div>
            <div className="text-xs text-muted-foreground mb-1">Correction Risk</div>
            <Badge
              variant="outline"
              className="font-mono"
              style={{ color: getRiskColor(signal.correction_risk) }}
            >
              {signal.correction_risk?.toFixed(0) || 0}%
            </Badge>
          </div>
          
          {signal.confluence_score !== null && signal.confluence_score !== undefined && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Confluence</div>
              <Badge variant="outline" className="font-mono">
                {signal.confluence_score?.toFixed(0)}
              </Badge>
            </div>
          )}
          
          {/* Show base signal if different from final */}
          {signal.signal_type && signal.ai_decision && signal.signal_type !== signal.ai_decision && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Base Signal</div>
              <Badge variant="outline" className="font-mono text-xs">
                {signal.signal_type.toUpperCase()}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Price levels for actionable signals only (buy/sell) */}
      {signal.entry_price && signal.stop_loss && (signal.signal_type === 'buy' || signal.signal_type === 'sell' || signal.signal_type === 'bullish' || signal.signal_type === 'bearish') && (
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Entry: </span>
            <span className="font-mono font-semibold">
              ${signal.entry_price.toFixed(2)}
            </span>
          </div>
          {signal.stop_loss && (
            <div>
              <span className="text-muted-foreground">Stop: </span>
              <span className="font-mono font-semibold text-red-600">
                ${signal.stop_loss.toFixed(2)}
              </span>
            </div>
          )}
          {signal.take_profit_1 && (
            <div>
              <span className="text-muted-foreground">Target: </span>
              <span className="font-mono font-semibold text-green-600">
                ${signal.take_profit_1.toFixed(2)}
              </span>
            </div>
          )}
          {signal.take_profit_2 && (
            <div>
              <span className="text-muted-foreground">Target 2: </span>
              <span className="font-mono font-semibold text-green-600">
                ${signal.take_profit_2.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function getSignalColor(signal: string): string {
  switch (signal?.toLowerCase()) {
    case 'buy':
    case 'bullish':
      return '#00D980';
    case 'sell':
    case 'bearish':
      return '#FF4C4C';
    default:
      return '#FFC400';
  }
}

function getSignalIcon(signal: string) {
  switch (signal?.toLowerCase()) {
    case 'buy':
    case 'bullish':
      return <TrendingUp className="h-6 w-6 text-green-600" />;
    case 'sell':
    case 'bearish':
      return <TrendingDown className="h-6 w-6 text-red-600" />;
    default:
      return <Minus className="h-6 w-6 text-yellow-600" />;
  }
}


function getRiskColor(risk: number): string {
  if (risk >= 70) return '#FF4C4C';
  if (risk >= 40) return '#FFC400';
  return '#00D980';
}
