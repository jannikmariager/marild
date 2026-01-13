import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DollarSign, TrendingUp, Users, CreditCard } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { getRevenueMetrics, getSubscriptionBreakdown, getRevenueChartData } from '@/lib/stripe'
export const dynamic = 'force-dynamic'

async function getRevenueStats() {
  // Use Stripe helpers for accurate revenue calculations
  const metrics = await getRevenueMetrics()
  const breakdown = await getSubscriptionBreakdown()
  const chartData = await getRevenueChartData()

  // Calculate total paying users from breakdown
  const totalPayingUsers = breakdown.reduce((sum, plan) => sum + plan.count, 0)

  return {
    ...metrics,
    breakdown,
    chartData,
    totalPayingUsers,
  }
}

export default async function RevenuePage() {
  const stats = await getRevenueStats()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Revenue Analytics</h1>
        <p className="text-muted-foreground mt-1">Track subscription revenue and forecasts</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="MRR"
          value={`$${stats.mrr.toLocaleString()}`}
          icon={DollarSign}
          trend={{ value: stats.revenueGrowth, label: 'vs last month', isPositive: stats.revenueGrowth > 0 }}
        />

        <KPITile
          title="ARR"
          value={`$${stats.arr.toLocaleString()}`}
          icon={TrendingUp}
        />

        <KPITile
          title="Active Subscriptions"
          value={stats.activeSubscriptions}
          icon={Users}
        />

        <KPITile
          title="Churn Rate"
          value={`${stats.churnRate}%`}
          icon={CreditCard}
          trend={{ value: stats.churnRate, label: 'last 30 days', isPositive: false }}
        />
      </div>

      {/* Subscription Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription Breakdown</CardTitle>
            <CardDescription>Active subscribers by tier</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.breakdown.map((plan, index) => {
              const colors = [
                { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-300' },
                { bg: 'bg-purple-500/10', text: 'text-purple-700 dark:text-purple-300' },
                { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300' },
              ]
              const color = colors[index % colors.length]
              
              return (
                <div key={plan.plan} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">{plan.plan}</p>
                    <p className="text-2xl font-bold text-foreground">{plan.count} subscribers</p>
                    <p className="text-xs text-muted-foreground mt-1">${plan.revenue.toLocaleString()}/mo</p>
                  </div>
                  <div className={`h-12 w-12 rounded-full ${color.bg} flex items-center justify-center`}>
                    <Users className={`h-6 w-6 ${color.text}`} />
                  </div>
                </div>
              )
            })}

            <div className="flex items-center justify-between p-4 bg-muted rounded-lg border-2 border-emerald-500/20">
              <div>
                <p className="text-sm text-muted-foreground">Total Paying Users</p>
                <p className="text-2xl font-bold text-foreground">{stats.totalPayingUsers}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">LTV: ${stats.lifetimeValue.toLocaleString()}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Forecast</CardTitle>
            <CardDescription>Projected annual revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground">Current ARR</span>
                  <span className="text-foreground font-medium">${stats.arr.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: '100%' }} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground">Projected (12mo)</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    ${(stats.arr * (1 + stats.revenueGrowth / 100)).toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500/50" style={{ width: '80%' }} />
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-2">Growth Rate</p>
                <p className={`text-3xl font-bold ${stats.revenueGrowth >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {stats.revenueGrowth >= 0 ? '+' : ''}{stats.revenueGrowth}%
                </p>
                <p className="text-sm text-muted-foreground mt-1">Month over month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue Trend</CardTitle>
          <CardDescription>Revenue over the last 12 months</CardDescription>
        </CardHeader>
        <CardContent>
          <RevenueChart data={stats.chartData} />
        </CardContent>
      </Card>
    </div>
  )
}
