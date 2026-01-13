import { fetchAllVariantResults, fetchVariantAggregate } from '@/lib/server/engineVariantQueries'
import { rankVariants, type RankedVariantRow, type VariantAggregateRow } from '@/lib/server/variantRanking'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings2 } from 'lucide-react'
import { QueryProvider } from '@/components/providers/query-provider'
import { VariantDashboardClient } from '@/components/admin/engines/VariantDashboardClient'

export const dynamic = 'force-dynamic'

export default async function EngineVariantsPage() {
  const [aggregateRaw, allRuns] = await Promise.all([
    fetchVariantAggregate(),
    fetchAllVariantResults(),
  ])

  const aggregate = (aggregateRaw as VariantAggregateRow[]) || []
  const ranked: RankedVariantRow[] = rankVariants(aggregate)

  return (
    <QueryProvider>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Engine Filter Variants</h1>
            <p className="text-muted-foreground mt-1">
              Compare V7.x filter configurations across tickers, metrics, and timeframes.
            </p>
          </div>
          <Card className="rounded-2xl shadow-md">
            <CardHeader className="flex flex-row items-center gap-3 pb-3">
              <Settings2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <CardTitle className="text-sm">Admin Tools</CardTitle>
                <CardDescription className="text-xs">
                  Internal V7.x engine tuning workspace.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">How to use this dashboard</CardTitle>
            <CardDescription className="text-xs">
              This page visualizes data from the <code className="rounded bg-muted px-1 py-0.5 text-[10px]">engine_filter_performance</code> table.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>1. Run the V7.x engine variant benchmark in the backend:</p>
            <p className="ml-4 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
              deno run --allow-env --allow-net --allow-read tools/run_engine_variant_tests.ts
            </p>
            <p>2. Ensure Supabase migrations are applied in <span className="font-mono">tradelens_ai</span>:</p>
            <ul className="ml-5 list-disc space-y-0.5">
              <li><span className="font-mono">20251209_create_engine_filter_performance.sql</span></li>
              <li><span className="font-mono">20251209_variant_aggregate_metrics.sql</span></li>
            </ul>
            <p>3. Refresh this page to load the latest variant performance and rankings.</p>
          </CardContent>
        </Card>

        <VariantDashboardClient aggregates={aggregate} ranked={ranked} runs={allRuns} />
      </div>
    </QueryProvider>
  )
}
