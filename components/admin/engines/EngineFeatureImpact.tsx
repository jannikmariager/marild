'use client';

import React from 'react';

export const EngineFeatureImpact: React.FC = () => {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-white">Feature Impact</h2>
      <p className="text-xs text-slate-400">
        This section visualizes how new modules (HTF alignment, Order Blocks, BOS, Momentum, etc.)
        impact key metrics between engine versions. Hook this up to engine_versions.metrics and
        engine_comparison_results deltas.
      </p>
    </div>
  );
};
