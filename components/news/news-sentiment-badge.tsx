import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface NewsSentimentBadgeProps {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score?: number;
  showIcon?: boolean;
  className?: string;
}

export function NewsSentimentBadge({
  sentiment,
  score,
  showIcon = true,
  className,
}: NewsSentimentBadgeProps) {
  const config = {
    bullish: {
      label: 'Bullish',
      icon: TrendingUp,
      className: 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20',
    },
    bearish: {
      label: 'Bearish',
      icon: TrendingDown,
      className: 'bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20',
    },
    neutral: {
      label: 'Neutral',
      icon: Minus,
      className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
    },
  };

  const { label, icon: Icon, className: variantClassName } = config[sentiment] || config.neutral;

  return (
    <Badge
      variant="outline"
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 text-xs font-medium',
        variantClassName,
        className
      )}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      <span>{label}</span>
      {score !== undefined && (
        <span className="text-[10px] opacity-70">
          ({Math.round(score * 100)}%)
        </span>
      )}
    </Badge>
  );
}
