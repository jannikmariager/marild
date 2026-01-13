import { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KPITileProps {
  title: string
  value: string | number
  icon: LucideIcon
  trend?: {
    value: number
    label: string
    isPositive?: boolean
  }
  className?: string
}

export function KPITile({ title, value, icon: Icon, trend, className }: KPITileProps) {
  return (
    <Card className={cn(className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold text-foreground mt-2">{value}</p>
            {trend && (
              <p className="text-sm mt-2">
                <span
                  className={cn(
                    'font-medium',
                    trend.isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {trend.isPositive ? '+' : ''}
                  {trend.value}%
                </span>
                <span className="text-muted-foreground ml-1">{trend.label}</span>
              </p>
            )}
          </div>
          <div className="h-12 w-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
