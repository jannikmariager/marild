'use client'

import { useEffect, useState } from 'react'
import { formatNyDateTime } from '@/lib/datetime'

interface NyTimeBadgeProps {
  label?: string
  refreshMs?: number
}

export function NyTimeBadge({ label = 'Current NY time', refreshMs = 30_000 }: NyTimeBadgeProps) {
  const [timestamp, setTimestamp] = useState(() => formatNyDateTime(new Date()))

  useEffect(() => {
    const id = setInterval(() => {
      setTimestamp(formatNyDateTime(new Date()))
    }, refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold">
      <span className="uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{timestamp}</span>
    </div>
  )
}
