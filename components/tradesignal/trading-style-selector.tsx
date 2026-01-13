'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TradingStyle = 'daytrade' | 'swing' | 'invest';

interface TradingStyleSelectorProps {
  value: TradingStyle;
  onChange: (value: TradingStyle) => void;
  className?: string;
}

const tradingStyles: Array<{ value: TradingStyle; label: string; emoji: string }> = [
  { value: 'daytrade', label: 'Daytrade', emoji: '⚡' },
  { value: 'swing', label: 'Swing', emoji: '🔁' },
  { value: 'invest', label: 'Investing', emoji: '🏦' },
];

export function TradingStyleSelector({ value, onChange, className }: TradingStyleSelectorProps) {
  return (
    <div className={cn('flex gap-2', className)}>
      {tradingStyles.map((style) => (
        <Button
          key={style.value}
          type="button"
          variant={value === style.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(style.value)}
          className={cn(
            'flex-1',
            value === style.value && 'bg-primary text-primary-foreground'
          )}
        >
          <span className="mr-1">{style.emoji}</span>
          {style.label}
        </Button>
      ))}
    </div>
  );
}

export function getTradingStyleLabel(style: TradingStyle): string {
  const found = tradingStyles.find((s) => s.value === style);
  return found ? `${found.emoji} ${found.label}` : style;
}

export function getTradingStyleEmoji(style: TradingStyle): string {
  const found = tradingStyles.find((s) => s.value === style);
  return found?.emoji || '';
}

export function determineTradingStyle(timeframe: string): TradingStyle {
  const tf = timeframe.toLowerCase();
  if (tf === '5m' || tf === '15m' || tf === '1h') return 'daytrade';
  if (tf === '4h') return 'swing';
  return 'invest'; // 1d, 1w
}
