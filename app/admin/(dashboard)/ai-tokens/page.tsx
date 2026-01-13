import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Cpu, DollarSign, TrendingUp, Zap } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { formatDistanceToNow } from 'date-fns'

async function getAITokenStats() {
  const supabase = await createAdminClient()

  const now = Date.now()
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthStartISO = monthStart.toISOString()

  // Get today's usage
  const { data: todayData } = await supabase
    .from('ai_usage_logs')
    .select('input_tokens, output_tokens, cost_usd')
    .gte('created_at', oneDayAgo)

  const tokensToday = todayData?.reduce(
    (sum, row) => sum + (row.input_tokens || 0) + (row.output_tokens || 0),
    0
  ) || 0

  const costToday = todayData?.reduce((sum, row) => sum + (row.cost_usd || 0), 0) || 0

  // Get 7-day usage (kept for context/future use)
  const { data: weekData } = await supabase
    .from('ai_usage_logs')
    .select('input_tokens, output_tokens, cost_usd')
    .gte('created_at', sevenDaysAgo)

  const tokensWeek = weekData?.reduce(
    (sum, row) => sum + (row.input_tokens || 0) + (row.output_tokens || 0),
    0
  ) || 0

  const costWeek = weekData?.reduce((sum, row) => sum + (row.cost_usd || 0), 0) || 0

  // Get month-to-date usage
  const { data: monthData } = await supabase
    .from('ai_usage_logs')
    .select('input_tokens, output_tokens, cost_usd')
    .gte('created_at', monthStartISO)

  const tokensMonth = monthData?.reduce(
    (sum, row) => sum + (row.input_tokens || 0) + (row.output_tokens || 0),
    0
  ) || 0

  const costMonth = monthData?.reduce((sum, row) => sum + (row.cost_usd || 0), 0) || 0

  // Build simple daily history for last 30 days
  const { data: historyData } = await supabase
    .from('ai_usage_logs')
    .select('input_tokens, output_tokens, cost_usd, created_at')
    .gte('created_at', thirtyDaysAgo)

  const historyMap = new Map<string, { tokens: number; cost: number }>()
  for (const row of historyData || []) {
    const created = row.created_at as string | null
    if (!created) continue
    const key = new Date(created).toISOString().slice(0, 10)
    const prev = historyMap.get(key) || { tokens: 0, cost: 0 }
    const tokens = (row.input_tokens || 0) + (row.output_tokens || 0)
    const cost = row.cost_usd || 0
    historyMap.set(key, {
      tokens: prev.tokens + tokens,
      cost: prev.cost + cost,
    })
  }

  const dailyHistory = Array.from(historyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, cost: v.cost }))

  // Get request count today
  const { count: requestsToday } = await supabase
    .from('ai_usage_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneDayAgo)

  // Get recent usage
  const { data: recentUsage } = await supabase
    .from('ai_usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return {
    tokensToday,
    costToday,
    tokensWeek,
    costWeek,
    tokensMonth,
    costMonth,
    requestsToday: requestsToday || 0,
    recentUsage: recentUsage || [],
    dailyHistory,
  }
}

export default async function AITokensPage() {
  const stats = await getAITokenStats()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Token Usage</h1>
        <p className="text-muted-foreground mt-1">Monitor AI model usage and costs</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="Tokens Today"
          value={stats.tokensToday.toLocaleString()}
          icon={Cpu}
        />

        <KPITile
          title="Tokens This Month"
          value={stats.tokensMonth.toLocaleString()}
          icon={TrendingUp}
          trend={{
            value: 0,
            label: `Cost: $${stats.costMonth.toFixed(2)}`,
            isPositive: true,
          }}
        />

        <KPITile
          title="Cost Today"
          value={`$${stats.costToday.toFixed(2)}`}
          icon={DollarSign}
        />

        <KPITile
          title="Requests Today"
          value={stats.requestsToday.toLocaleString()}
          icon={Zap}
        />
      </div>

      {/* 30-day Historical Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Token Usage History (last 30 days)</CardTitle>
          <CardDescription>Net tokens and costs by calendar day.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.dailyHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI token usage recorded in the last 30 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-muted-foreground">Date</TableHead>
                  <TableHead className="text-muted-foreground text-right">Tokens</TableHead>
                  <TableHead className="text-muted-foreground text-right">Cost (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.dailyHistory.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell>{day.date}</TableCell>
                    <TableCell className="text-right text-foreground">
                      {day.tokens.toLocaleString()}
                    </TableCell>
                  <TableCell className="text-right text-emerald-700 dark:text-emerald-300 font-medium">
                      {'$' + day.cost.toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent usage table (collapsed by default to save space) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Token Usage</CardTitle>
          <CardDescription>Latest AI model requests and costs (last 50 entries).</CardDescription>
        </CardHeader>
        <CardContent>
          <details className="mt-1">
            <summary className="cursor-pointer text-sm text-muted-foreground select-none">
              Show recent usage table
            </summary>
            <div className="mt-3">
              <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Model</TableHead>
                <TableHead className="text-muted-foreground">Task</TableHead>
                <TableHead className="text-muted-foreground">User</TableHead>
                <TableHead className="text-muted-foreground text-right">Input</TableHead>
                <TableHead className="text-muted-foreground text-right">Output</TableHead>
                <TableHead className="text-muted-foreground text-right">Cost</TableHead>
                <TableHead className="text-muted-foreground">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentUsage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No AI token usage found
                  </TableCell>
                </TableRow>
              ) : (
                stats.recentUsage.map((usage: any) => (
                  <TableRow key={usage.id}>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          usage.model?.includes('gpt-4o-mini')
                            ? 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300'
                            : 'bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-300'
                        }
                      >
                        {usage.model || 'Unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {usage.task || 'N/A'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {usage.user_id === '00000000-0000-0000-0000-000000000000' ? 'System' : (usage.user_id?.substring(0, 8) || 'N/A')}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {(usage.input_tokens || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {(usage.output_tokens || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700 dark:text-emerald-300 font-medium">
                      {'$' + (usage.cost_usd || 0).toFixed(4)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {usage.created_at
                        ? formatDistanceToNow(new Date(usage.created_at), { addSuffix: true })
                        : 'Unknown'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
