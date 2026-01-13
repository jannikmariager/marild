import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Bug, Smartphone, AlertTriangle, TrendingDown } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { formatDistanceToNow } from 'date-fns'

async function getCrashStats() {
  const supabase = await createAdminClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Get crashes today
  const { count: crashesToday } = await supabase
    .from('crashlogs')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', oneDayAgo)

  // Get crashes by platform
  const { data: crashesData } = await supabase
    .from('crashlogs')
    .select('platform')
    .gte('timestamp', oneDayAgo)

  const iosCrashes = crashesData?.filter(c => c.platform === 'ios').length || 0
  const androidCrashes = crashesData?.filter(c => c.platform === 'android').length || 0

  // Get recent crashes
  const { data: recentCrashes } = await supabase
    .from('crashlogs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100)

  return {
    crashesToday: crashesToday || 0,
    iosCrashes,
    androidCrashes,
    recentCrashes: recentCrashes || [],
  }
}

export default async function CrashesPage() {
  const stats = await getCrashStats()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Crash Reports</h1>
        <p className="text-muted-foreground mt-1">Monitor mobile app crashes and stability</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="Crashes Today"
          value={stats.crashesToday}
          icon={Bug}
          trend={{ value: -15, label: 'vs yesterday', isPositive: true }}
        />

        <KPITile
          title="iOS Crashes"
          value={stats.iosCrashes}
          icon={Smartphone}
        />

        <KPITile
          title="Android Crashes"
          value={stats.androidCrashes}
          icon={Smartphone}
        />

        <KPITile
          title="Crash Rate"
          value="0.02%"
          icon={TrendingDown}
        />
      </div>

      {/* Crashes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Crashes</CardTitle>
          <CardDescription>Latest mobile app crash reports</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Platform</TableHead>
                <TableHead className="text-muted-foreground">Device</TableHead>
                <TableHead className="text-muted-foreground">OS Version</TableHead>
                <TableHead className="text-muted-foreground">Error</TableHead>
                <TableHead className="text-muted-foreground">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentCrashes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No crashes found 🎉
                  </TableCell>
                </TableRow>
              ) : (
                stats.recentCrashes.map((crash: any) => (
                  <TableRow key={crash.id}>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          crash.platform === 'ios'
                            ? 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300'
                            : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300'
                        }
                      >
                        {crash.platform}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {crash.device || 'Unknown'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {crash.os_version || 'N/A'}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md">
                      <div className="truncate">{crash.error_message || 'No message'}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {crash.timestamp
                        ? formatDistanceToNow(new Date(crash.timestamp), { addSuffix: true })
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
