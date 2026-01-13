import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type EngineBadgeProps = {
  engineStyle?: string | null;
  engineKey?: string | null;
  className?: string;
};

export function EngineBadge({ engineStyle, engineKey, className }: EngineBadgeProps) {
  if (!engineStyle && !engineKey) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs px-2 py-1 font-medium border-dashed flex items-center gap-1',
        className,
      )}
    >
      <span role="img" aria-label="engine">
        ⚙️
      </span>
      <span>{engineStyle ?? 'Engine'}</span>
      {engineKey && (
        <span className="text-[11px] text-muted-foreground">• {engineKey}</span>
      )}
    </Badge>
  );
}
