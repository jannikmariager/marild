import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Database, DollarSign, TrendingUp, Activity } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { formatDistanceToNow } from 'date-fns'

async function getDataCostStats() {
  const supabase = await createAdminClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Get today's costs
  const { data: todayCosts } = await supabase
    .from('data_source_costs')
    .select('cost_usd, request_count')
    .gte('timestamp', oneDayAgo)

  const costToday = todayCosts?.reduce((sum, row) => sum + (row.cost_usd || 0), 0) || 0
  const requestsToday = todayCosts?.reduce((sum, row) => sum + (row.request_count || 0), 0) || 0

  // Get most expensive provider today
  const providerCostsToday = todayCosts?.reduce((acc: any, row: any) => {
    const provider = row.provider_name || 'unknown'
    acc[provider] = (acc[provider] || 0) + (row.cost_usd || 0)
    return acc
  }, {}) || {}

  const mostExpensiveProvider = Object.entries(providerCostsToday).sort(
    ([, a]: any, [, b]: any) => b - a
  )[0]

  // Get recent cost entries
  const { data: recentCosts } = await supabase
    .from('data_source_costs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100)

  return {
    costToday,
    requestsToday,
    mostExpensiveProvider: mostExpensiveProvider ? mostExpensiveProvider[0] : 'N/A',
    recentCosts: recentCosts || [],
  }
}

export default async function DataCostsPage() {
  const stats = await getDataCostStats()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Data Provider Costs</h1>
        <p className="text-muted-foreground mt-1">Monitor external API usage and costs</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="Cost Today"
          value={`$${stats.costToday.toFixed(2)}`}
          icon={DollarSign}
          trend={{ value: -5, label: 'vs yesterday', isPositive: true }}
        />

        <KPITile
          title="Requests Today"
          value={stats.requestsToday.toLocaleString()}
          icon={Activity}
        />

        <KPITile
          title="Most Expensive"
          value={stats.mostExpensiveProvider}
          icon={Database}
        />

        <KPITile
          title="Avg Cost/Request"
          value={`$${(stats.costToday / (stats.requestsToday || 1)).toFixed(4)}`}
          icon={TrendingUp}
        />
      </div>

      {/* Costs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Costs</CardTitle>
          <CardDescription>Recent API usage and costs by provider</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Provider</TableHead>
                <TableHead className="text-muted-foreground text-right">Requests</TableHead>
                <TableHead className="text-muted-foreground text-right">Cost</TableHead>
                <TableHead className="text-muted-foreground">Period</TableHead>
                <TableHead className="text-muted-foreground">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentCosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No cost data found
                  </TableCell>
                </TableRow>
              ) : (
                stats.recentCosts.map((cost: any) => (
                  <TableRow key={cost.id}>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-300"
                      >
                        {cost.provider_name || 'Unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {(cost.request_count || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700 dark:text-emerald-300 font-medium">
                      ${(cost.cost_usd || 0).toFixed(4)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {cost.period || 'daily'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {cost.timestamp
                        ? formatDistanceToNow(new Date(cost.timestamp), { addSuffix: true })
                        : 'Unknown'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
