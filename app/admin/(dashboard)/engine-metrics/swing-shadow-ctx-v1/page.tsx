'use client'

import { NyTimeBadge } from '@/components/admin/NyTimeBadge'
import { SwingContextShadowEngine } from '@/components/admin/engines/SwingContextShadowEngine'

export default function SwingContextShadowMetricsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">SWING Context Shadow V1</h1>
          <p className="text-muted-foreground mt-2">
            Shadow run monitoring for SWING_SHADOW_CTX_V1 with market-context-based gating and risk scaling.
          </p>
        </div>
        <NyTimeBadge />
      </div>
      <SwingContextShadowEngine />
    </div>
  )
}