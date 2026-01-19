'use client';

import { QuickProfitEngine } from '@/components/admin/engines/QuickProfitEngine';

export default function QuickProfitMetricsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Quick profit metrics</h1>
        <p className="text-muted-foreground mt-2">Shadow run monitoring for QUICK_PROFIT_V1</p>
      </div>
      <QuickProfitEngine />
    </div>
  );
}
