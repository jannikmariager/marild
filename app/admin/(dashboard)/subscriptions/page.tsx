import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CreditCard, TrendingUp, Users, DollarSign } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { formatDistanceToNow } from 'date-fns'
type SubscriptionLog = {
  id: string
  event_type: string
  amount?: number | null
  amount_usd?: number | null
  country?: string | null
  timestamp?: string | null
}

async function getSubscriptionStats() {
  const supabase = await createAdminClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Get subscription event counts
  const { count: totalEvents } = await supabase
    .from('subscription_logs')
    .select('*', { count: 'exact', head: true })

  const { count: eventsToday } = await supabase
    .from('subscription_logs')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', oneDayAgo)

  // Get active subscriptions count (from users)
  const { count: activeSubscriptions } = await supabase
    .from('subscription_status')
    .select('*', { count: 'exact', head: true })
    .in('tier', ['premium', 'pro', 'pro_plus', 'pro_tier'])

  // Get recent subscription events
  const { data: events } = await supabase
    .from('subscription_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100)

  // Calculate revenue from events
  const { data: revenueData } = await supabase
    .from('subscription_logs')
    .select('amount')
    .gte('timestamp', oneDayAgo)
    .in('event_type', ['invoice.payment_succeeded'])

  const revenueToday = revenueData?.reduce((sum, row) => sum + (row.amount || 0), 0) || 0

  return {
    totalEvents: totalEvents || 0,
    eventsToday: eventsToday || 0,
    activeSubscriptions: activeSubscriptions || 0,
    revenueToday: revenueToday / 100, // Convert cents to dollars
    events: events || [],
  }
}

export default async function SubscriptionsPage() {
  const stats = await getSubscriptionStats()

  const getEventColor = (eventType: string) => {
    if (eventType.includes('succeeded')) return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300'
    if (eventType.includes('failed')) return 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300'
    if (eventType.includes('created')) return 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300'
    if (eventType.includes('canceled')) return 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300'
    return 'bg-muted text-muted-foreground border-border'
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Subscriptions</h1>
        <p className="text-muted-foreground mt-1">Monitor subscription events and revenue</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="Active Subscriptions"
          value={stats.activeSubscriptions}
          icon={Users}
          trend={{ value: 8, label: 'vs last week', isPositive: true }}
        />

        <KPITile
          title="Events Today"
          value={stats.eventsToday}
          icon={TrendingUp}
        />

        <KPITile
          title="Revenue Today"
          value={`$${stats.revenueToday.toFixed(2)}`}
          icon={DollarSign}
        />

        <KPITile
          title="Total Events"
          value={stats.totalEvents.toLocaleString()}
          icon={CreditCard}
        />
      </div>

      {/* Events Table */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription Events</CardTitle>
          <CardDescription>Recent Stripe webhook events</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Event Type</TableHead>
                <TableHead className="text-muted-foreground">Amount</TableHead>
                <TableHead className="text-muted-foreground">Country</TableHead>
                <TableHead className="text-muted-foreground">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No subscription events found
                  </TableCell>
                </TableRow>
              ) : (
                stats.events.map((event: SubscriptionLog) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <Badge variant="secondary" className={getEventColor(event.event_type)}>
                        {event.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {event.amount ? `$${(event.amount / 100).toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {event.country || 'Unknown'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {event.timestamp
                        ? formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })
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
