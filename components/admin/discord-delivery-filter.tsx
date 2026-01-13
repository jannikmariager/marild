'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

type DiscordDeliveryFilterValue = 'all' | 'not_posted' | 'failed'

export function DiscordDeliveryFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const current = (searchParams.get('discord') as DiscordDeliveryFilterValue) || 'all'

  const setFilter = (value: DiscordDeliveryFilterValue) => {
    const params = new URLSearchParams(searchParams.toString())

    if (value === 'all') {
      params.delete('discord')
    } else {
      params.set('discord', value)
    }

    // Don't scroll to the top on filter changes.
    router.push(`?${params.toString()}`, { scroll: false })
  }

  const isActive = (value: DiscordDeliveryFilterValue) => current === value

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground mr-2">Discord:</span>
      <Button
        variant={isActive('all') ? 'default' : 'outline'}
        size="sm"
        onClick={() => setFilter('all')}
        className={isActive('all') ? '' : 'text-muted-foreground'}
      >
        All
      </Button>
      <Button
        variant={isActive('not_posted') ? 'default' : 'outline'}
        size="sm"
        onClick={() => setFilter('not_posted')}
        className={isActive('not_posted') ? 'bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/20 dark:text-amber-300' : 'text-muted-foreground'}
      >
        Not posted
      </Button>
      <Button
        variant={isActive('failed') ? 'default' : 'outline'}
        size="sm"
        onClick={() => setFilter('failed')}
        className={isActive('failed') ? 'bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20 dark:text-red-300' : 'text-muted-foreground'}
      >
        Failed
      </Button>
    </div>
  )
}
