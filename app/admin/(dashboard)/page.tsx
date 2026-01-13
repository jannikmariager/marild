import { createAdminClient } from '@/lib/supabase/server'
import { KPITile } from '@/components/admin/kpi-tile'
import { Users, DollarSign, TrendingUp, AlertTriangle, Cpu, Database } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UserGrowthChart } from '@/components/charts/user-growth-chart'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { getRevenueChartData } from '@/lib/stripe'

async function getDashboardStats() {
  const supabase = await createAdminClient()

  // Get user counts
  const { count: totalUsers } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })

  // Get users from last 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: newUsersToday } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneDayAgo)

  // Get AI token usage today
  const { data: aiTokensToday } = await supabase
    .from('ai_token_usage')
    .select('total_cost_usd')
    .gte('created_at', oneDayAgo)

  const aiCostToday = aiTokensToday?.reduce((sum, row) => sum + (row.total_cost_usd || 0), 0) || 0

  // Get system alerts today
  const { count: alertsToday } = await supabase
    .from('system_alerts')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', oneDayAgo)
    .eq('resolved', false)

  // Get crashes today
  const { count: crashesToday } = await supabase
    .from('crashlogs')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', oneDayAgo)

  // Get data provider costs today
  const { data: dataCostsToday } = await supabase
    .from('data_source_costs')
    .select('cost_usd')
    .gte('timestamp', oneDayAgo)

  const dataProviderCostToday = dataCostsToday?.reduce((sum, row) => sum + (row.cost_usd || 0), 0) || 0

  // Get user growth data for last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const userGrowthData = []
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .lte('created_at', startOfDay.toISOString())
    
    userGrowthData.push({
      date: startOfDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      users: count || 0,
    })
  }

  // Get revenue chart data
  const revenueChartData = await getRevenueChartData()

  return {
    totalUsers: totalUsers || 0,
    newUsersToday: newUsersToday || 0,
    aiCostToday,
    alertsToday: alertsToday || 0,
    crashesToday: crashesToday || 0,
    dataProviderCostToday,
    userGrowthData,
    revenueChartData,
  }
}

export default async function AdminDashboardPage() {
  const stats = await getDashboardStats()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of TradeLens AI system metrics
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KPITile
          title="Total Users"
          value={stats.totalUsers.toLocaleString()}
          icon={Users}
          trend={{ value: 12, label: 'vs last week', isPositive: true }}
        />

        <KPITile
          title="New Users (24h)"
          value={stats.newUsersToday.toLocaleString()}
          icon={TrendingUp}
        />

        <KPITile
          title="AI Cost (Today)"
          value={`$${stats.aiCostToday.toFixed(2)}`}
          icon={Cpu}
          trend={{ value: -8, label: 'vs yesterday', isPositive: true }}
        />

        <KPITile
          title="Data Provider Cost"
          value={`$${stats.dataProviderCostToday.toFixed(2)}`}
          icon={Database}
        />

        <KPITile
          title="Active Alerts"
          value={stats.alertsToday}
          icon={AlertTriangle}
        />

        <KPITile
          title="Crashes (24h)"
          value={stats.crashesToday}
          icon={AlertTriangle}
        />
      </div>

      {/* Charts Section */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>User Growth</CardTitle>
            <CardDescription>Total users over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <UserGrowthChart data={stats.userGrowthData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
            <CardDescription>Monthly revenue over the last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart data={stats.revenueChartData} />
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest system events and user actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-muted-foreground text-sm">
              Activity feed will be implemented with real-time data
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
