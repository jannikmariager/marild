type SubscriptionStatusRow = {
  user_id: string
  tier: string | null
}

import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Users as UsersIcon, TrendingUp, CreditCard, DollarSign } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

const ACTIVE_SUB_TIERS = ['pro', 'premium', 'pro_plus', 'pro_tier', 'admin'] as const

type AdminUserRow = {
  user_id: string
  email: string | null
  subscription_tier: string | null
  created_at: string | null
  updated_at: string | null
}

type EnrichedUserRow = {
  user_id: string
  email: string | null
  created_at: string | null
  updated_at: string | null
  plan: string
  isActive: boolean
}

type SubscriptionSummary = {
  activeSubscriptions: number
  eventsToday: number
  revenueToday: number
  totalEvents: number
}

async function getUsers() {
  const supabase = await createAdminClient()

  const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [{ count: totalUsers }, { count: newUsersToday }, activeSubsRes, eventsTodayRes, totalEventsRes, revenueRowsRes, usersRes] =
    await Promise.all([
      supabase.from('user_profile').select('*', { count: 'exact', head: true }),
      supabase
        .from('user_profile')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneDayAgoIso),
      supabase
        .from('subscription_status')
        .select('*', { count: 'exact', head: true })
        .in('tier', ACTIVE_SUB_TIERS as unknown as string[]),
      supabase
        .from('subscription_logs')
        .select('*', { count: 'exact', head: true })
        .gte('timestamp', oneDayAgoIso),
      supabase.from('subscription_logs').select('*', { count: 'exact', head: true }),
      supabase
        .from('subscription_logs')
        .select('amount_usd, amount')
        .gte('timestamp', oneDayAgoIso)
        .in('event_type', ['invoice.payment_succeeded', 'payment_intent.succeeded']),
      supabase
        .from('user_profile')
        .select('user_id, email, subscription_tier, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(50),
    ])

  if (usersRes.error) {
    console.error('Error fetching users:', usersRes.error)
    return {
      totalUsers: 0,
      newUsersToday: 0,
      users: [] as EnrichedUserRow[],
      summary: { activeSubscriptions: 0, eventsToday: 0, revenueToday: 0, totalEvents: 0 },
    }
  }

  const users = (usersRes.data || []) as AdminUserRow[]
  const userIds = users.map((user) => user.user_id).filter(Boolean)

  const statusRows = userIds.length
    ? await supabase
        .from('subscription_status')
        .select('user_id, tier')
        .in('user_id', userIds)
    : { data: [] }

  const statusMap = new Map<string, string | null>()
  const statusData: SubscriptionStatusRow[] = (statusRows?.data as SubscriptionStatusRow[]) ?? []
  statusData.forEach((row) => statusMap.set(row.user_id, row.tier))


  const enrichedUsers: EnrichedUserRow[] = users.map((user) => {
    const plan = statusMap.get(user.user_id) ?? user.subscription_tier ?? 'free'
    return {
      user_id: user.user_id,
      email: user.email,
      created_at: user.created_at,
      updated_at: user.updated_at,
      plan,
      isActive: ACTIVE_SUB_TIERS.includes(plan as (typeof ACTIVE_SUB_TIERS)[number]),
    }
  })

  const revenueToday =
    revenueRowsRes.data?.reduce((sum, row) => sum + (row.amount_usd ?? (row.amount ?? 0) / 100), 0) ?? 0

  const summary: SubscriptionSummary = {
    activeSubscriptions: activeSubsRes.count || 0,
    eventsToday: eventsTodayRes.count || 0,
    revenueToday,
    totalEvents: totalEventsRes.count || 0,
  }

  return {
    totalUsers: totalUsers || 0,
    newUsersToday: newUsersToday || 0,
    users: enrichedUsers,
    summary,
  }
}

export default async function UsersPage() {
  const { totalUsers, newUsersToday, users, summary } = await getUsers()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Users</h1>
        <p className="text-muted-foreground mt-1">Manage user accounts and subscriptions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <KPITile
          title="Total Users"
          value={totalUsers.toLocaleString()}
          icon={UsersIcon}
          trend={{ value: 12, label: 'vs last week', isPositive: true }}
        />

        <KPITile title="New Users (24h)" value={newUsersToday.toLocaleString()} icon={TrendingUp} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="Active Subscriptions"
          value={summary.activeSubscriptions.toLocaleString()}
          icon={UsersIcon}
        />
        <KPITile title="Events Today" value={summary.eventsToday.toLocaleString()} icon={TrendingUp} />
        <KPITile title="Revenue Today" value={`$${summary.revenueToday.toFixed(2)}`} icon={DollarSign} />
        <KPITile title="Total Events" value={summary.totalEvents.toLocaleString()} icon={CreditCard} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
          <CardDescription>Latest user signups and activity</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Email</TableHead>
                <TableHead className="text-muted-foreground">Plan</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Created</TableHead>
                <TableHead className="text-muted-foreground">Last Updated</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  return (
                    <TableRow key={user.user_id}>
                      <TableCell className="font-medium">
                        {user.email || 'No email'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.isActive ? 'default' : 'secondary'}
                          className={
                            user.isActive
                              ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300'
                              : 'bg-muted text-muted-foreground border-border'
                          }
                        >
                          {user.plan}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.isActive ? 'outline' : 'secondary'}
                          className={
                            user.isActive
                              ? 'border-emerald-400 text-emerald-700 dark:text-emerald-300'
                              : 'border-border text-muted-foreground'
                          }
                        >
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.created_at
                          ? formatDistanceToNow(new Date(user.created_at), { addSuffix: true })
                          : 'Unknown'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.updated_at
                          ? formatDistanceToNow(new Date(user.updated_at), { addSuffix: true })
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/users/${user.user_id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                          >
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
