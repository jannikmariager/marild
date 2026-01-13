'use client';

import React from 'react';
import { SimpleEngineTable } from './SimpleEngineTable';

export const EngineEvolutionDashboard: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <SimpleEngineTable />
      </section>
    </div>
  );
};
