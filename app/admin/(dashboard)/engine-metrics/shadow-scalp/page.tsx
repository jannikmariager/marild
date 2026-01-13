'use client';

import { ShadowScalpEngine } from '@/components/admin/engines/ShadowScalpEngine';

export default function ShadowScalpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Engine Metrics</h1>
        <p className="text-muted-foreground mt-2">
          Shadow Scalp Engine - SCALP_V1_MICROEDGE
        </p>
      </div>
      <ShadowScalpEngine />
    </div>
  );
}
