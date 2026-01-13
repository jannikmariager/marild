import { EngineEvolutionDashboard } from '@/components/admin/engines/EngineEvolutionDashboard';
import { ShadowScalpEngine } from '@/components/admin/engines/ShadowScalpEngine';
import { QueryProvider } from '@/components/providers/query-provider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAllVariantResults, fetchVariantAggregate } from '@/lib/server/engineVariantQueries';
import { rankVariants, type RankedVariantRow, type VariantAggregateRow } from '@/lib/server/variantRanking';
import { VariantDashboardClient } from '@/components/admin/engines/VariantDashboardClient';
import { UniverseTab } from './UniverseTab';
import { EngineSettingsClient } from './EngineSettingsClient';
import { getStrategyFlags } from './engineFlagsActions';

interface PageProps {
  searchParams?: {
    engineVersion?: string;
  };
}

export default async function EnginesDashboardPage({ searchParams }: PageProps) {
  const [aggregateRaw, allRuns, flags] = await Promise.all([
    fetchVariantAggregate(),
    fetchAllVariantResults(),
    getStrategyFlags(),
  ]);

  const engineVersion = searchParams?.engineVersion ?? 'v7.4';

  const aggregate = (aggregateRaw as VariantAggregateRow[]) || [];
  const ranked: RankedVariantRow[] = rankVariants(aggregate);

  return (
    <QueryProvider>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Engine Performance</h1>
          <p className="text-muted-foreground mt-1">
            Compare engine versions, filter variants and manage universes.
          </p>
        </div>

        <Tabs defaultValue="versions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="versions">Engine versions</TabsTrigger>
            <TabsTrigger value="variants">Filter variants (V7.x)</TabsTrigger>
            <TabsTrigger value="universe">Ticker universe</TabsTrigger>
            <TabsTrigger value="settings">Engine settings</TabsTrigger>
            <TabsTrigger value="scalp">Shadow Scalp Engine</TabsTrigger>
          </TabsList>
          <TabsContent value="versions" className="space-y-4">
            <EngineEvolutionDashboard />
          </TabsContent>
          <TabsContent value="variants" className="space-y-4">
            <VariantDashboardClient aggregates={aggregate} ranked={ranked} runs={allRuns} />
          </TabsContent>
          <TabsContent value="universe" className="space-y-4">
            {/* Single live trading universe. Other styles are research-only and hidden here. */}
            <UniverseTab engineVersion={engineVersion} horizon="swing" />
          </TabsContent>
          <TabsContent value="settings" className="space-y-4">
            <EngineSettingsClient flags={flags} />
          </TabsContent>
          <TabsContent value="scalp" className="space-y-4">
            <ShadowScalpEngine />
          </TabsContent>
        </Tabs>
      </div>
    </QueryProvider>
  );
}
