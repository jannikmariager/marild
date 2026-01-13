'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function TradingStyleFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentStyle = searchParams.get('tradingStyle') || 'all'

  const handleStyleChange = (style: string) => {
    const params = new URLSearchParams(searchParams.toString())

    if (style === 'all') {
      params.delete('tradingStyle')
    } else {
      params.set('tradingStyle', style)
    }

    // Don't scroll to the top on filter changes.
    router.push(`?${params.toString()}`, { scroll: false })
  }

  const isActive = (style: string) => currentStyle === style

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground mr-2">Trading Style:</span>
      <Button
        variant={isActive('all') ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleStyleChange('all')}
        className={isActive('all') ? '' : 'text-muted-foreground'}
      >
        All
      </Button>
      <Button
        variant={isActive('daytrade') ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleStyleChange('daytrade')}
        className={
          isActive('daytrade')
            ? 'bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20 dark:text-red-300'
            : 'text-muted-foreground'
        }
      >
        ⚡ Daytrade
      </Button>
      <Button
        variant={isActive('swing') ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleStyleChange('swing')}
        className={
          isActive('swing')
            ? 'bg-blue-500/15 text-blue-700 border-blue-500/30 hover:bg-blue-500/20 dark:text-blue-300'
            : 'text-muted-foreground'
        }
      >
        🔁 Swingtrade
      </Button>
      <Button
        variant={isActive('invest') ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleStyleChange('invest')}
        className={
          isActive('invest')
            ? 'bg-purple-500/15 text-purple-700 border-purple-500/30 hover:bg-purple-500/20 dark:text-purple-300'
            : 'text-muted-foreground'
        }
      >
        🏦 Investing
      </Button>
    </div>
  )
}
