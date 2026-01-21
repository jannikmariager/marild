'use client';

import { QuickProfitEngine } from '@/components/admin/engines/QuickProfitEngine';
import { NyTimeBadge } from '@/components/admin/NyTimeBadge';

export default function QuickProfitMetricsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Quick profit metrics</h1>
          <p className="text-muted-foreground mt-2">Shadow run monitoring for QUICK_PROFIT_V1</p>
        </div>
        <NyTimeBadge />
      </div>
      <QuickProfitEngine />
    </div>
  );
}
