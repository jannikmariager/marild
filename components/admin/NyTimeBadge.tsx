'use client'

import { useEffect, useState } from 'react'
import { formatNyDateTime } from '@/lib/datetime'

interface NyTimeBadgeProps {
  label?: string
  refreshMs?: number
}

export function NyTimeBadge({ label = 'Current NY time', refreshMs = 30_000 }: NyTimeBadgeProps) {
  // Avoid using Date/formatting during SSR to prevent hydration mismatches.
  // We start empty, then populate once on the client.
  const [timestamp, setTimestamp] = useState<string | null>(null)

  useEffect(() => {
    const update = () => setTimestamp(formatNyDateTime(new Date()))
    update()
    const id = setInterval(update, refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold">
      <span className="uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{timestamp}</span>
    </div>
  )
}
