import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { UserActionButtons } from '@/components/admin/user-action-buttons'

type AdminUser = {
  user_id: string
  email: string | null
  subscription_tier: string | null
  country?: string | null
  created_at: string | null
  updated_at?: string | null
}

type SubscriptionStatus = {
  tier?: string | null
  renewed_at?: string | null
}

type TrialStatus = {
  active?: boolean | null
  expires_at?: string | null
}

type AIUsageRow = {
  id: string
  model?: string | null
  task?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  created_at?: string | null
}

type SubscriptionEvent = {
  id: string
  event_type: string
  amount?: number | null
  amount_usd?: number | null
  country?: string | null
  timestamp?: string | null
}

async function getUserDetail(userId: string) {
  const supabase = await createAdminClient()

  const { data: user, error: userError } = await supabase
    .from('user_profile')
    .select('user_id, email, subscription_tier, country, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (userError || !user) {
    return null
  }
  const [{ data: subscriptionStatus }, { data: trialStatus }] = await Promise.all([
    supabase
      .from('subscription_status')
      .select('tier, renewed_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('trial_status')
      .select('active, expires_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const { data: aiUsage } = await supabase
    .from('ai_usage_logs')
    .select('id, model, task, input_tokens, output_tokens, cost_usd, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  let subscriptionEvents: SubscriptionEvent[] = []
  let subscriptionEventError: string | null = null

  const { data: subLogs, error: subLogsError } = await supabase
    .from('subscription_logs')
    .select('id, event_type, amount, amount_usd, country, timestamp')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(20)

  if (subLogsError) {
    subscriptionEventError = subLogsError.message
  } else if (subLogs) {
    subscriptionEvents = subLogs as SubscriptionEvent[]
  }

  return {
    user: user as AdminUser,
    subscriptionStatus: (subscriptionStatus ?? null) as SubscriptionStatus | null,
    trialStatus: (trialStatus ?? null) as TrialStatus | null,
    aiUsage: (aiUsage ?? []) as AIUsageRow[],
    subscriptionEvents,
    subscriptionEventError,
  }
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getUserDetail(id)

  if (!detail) {
    notFound()
  }

  const { user, subscriptionStatus, trialStatus, aiUsage, subscriptionEvents, subscriptionEventError } = detail

  const totalTokens = aiUsage.reduce(
    (sum, row) => sum + (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
    0,
  )
  const totalCost = aiUsage.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)
  const subscriptionTier = subscriptionStatus?.tier ?? user.subscription_tier ?? 'unknown'
  const isDisabled = (subscriptionTier || '').toLowerCase() === 'disabled'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/users" className="text-emerald-600 hover:underline">
              Users
            </Link>{' '}
            / {user.email || user.user_id}
          </p>
          <h1 className="text-3xl font-bold text-foreground mt-1">{user.email || 'Unknown user'}</h1>
          <p className="text-muted-foreground">
            User ID: <span className="font-mono">{user.user_id}</span>
          </p>
        </div>
        <UserActionButtons userId={user.user_id} currentRole={subscriptionTier} isDisabled={isDisabled} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Role" value={subscriptionTier} />
        <SummaryCard label="Subscription Tier" value={subscriptionTier} />
        <SummaryCard
          label="Trial"
          value={
            trialStatus?.active
              ? trialStatus.expires_at
                ? `Active · expires ${new Date(trialStatus.expires_at).toLocaleDateString()}`
                : 'Active'
              : 'Inactive'
          }
        />
        <SummaryCard
          label="Created"
          value={
            user.created_at
              ? formatDistanceToNow(new Date(user.created_at), { addSuffix: true })
              : 'Unknown'
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Canonical information from Supabase</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Email" value={user.email ?? '—'} />
            <DetailRow label="Country" value={user.country ?? '—'} />
            <DetailRow
              label="Profile updated"
              value={
                user.updated_at
                  ? formatDistanceToNow(new Date(user.updated_at), { addSuffix: true })
                  : 'Unknown'
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent AI usage</CardTitle>
            <CardDescription>Last 20 requests attributed to this user</CardDescription>
          </CardHeader>
          <CardContent>
            {aiUsage.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI usage recorded for this user.</p>
            ) : (
              <>
                <div className="mb-4 flex gap-6 text-sm">
                  <div>
                    <p className="text-muted-foreground">Tokens (last 20)</p>
                    <p className="text-xl font-semibold">{totalTokens.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cost (USD)</p>
                    <p className="text-xl font-semibold">{`$${totalCost.toFixed(4)}`}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead>Task</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead>When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aiUsage.map((usage) => (
                        <TableRow key={usage.id}>
                          <TableCell>{usage.model ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {usage.task ?? '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {`$${(usage.cost_usd ?? 0).toFixed(4)}`}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {usage.created_at
                              ? formatDistanceToNow(new Date(usage.created_at), { addSuffix: true })
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscription history</CardTitle>
          <CardDescription>Latest billing events for this account</CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptionEventError && (
            <p className="mb-4 text-sm text-amber-600">
              Unable to load subscription events: {subscriptionEventError}
            </p>
          )}
          {subscriptionEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subscription events recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptionEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <Badge variant="secondary">{event.event_type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {event.amount_usd != null
                          ? `$${event.amount_usd.toFixed(2)}`
                          : event.amount != null
                            ? `$${(event.amount / 100).toFixed(2)}`
                            : '—'}
                      </TableCell>
                      <TableCell>{event.country ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {event.timestamp
                          ? formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  )
}

