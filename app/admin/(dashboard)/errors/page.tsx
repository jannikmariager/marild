import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { formatDistanceToNow } from 'date-fns'

async function getSystemAlerts() {
  const supabase = await createAdminClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Get unresolved alerts count
  const { count: unresolvedCount } = await supabase
    .from('system_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('resolved', false)

  // Get alerts from last 24h
  const { count: alertsToday } = await supabase
    .from('system_alerts')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', oneDayAgo)

  // Get critical alerts
  const { count: criticalCount } = await supabase
    .from('system_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('resolved', false)
    .in('type', ['error', 'api_down', 'payment_failed'])

  // Get recent alerts
  const { data: alerts } = await supabase
    .from('system_alerts')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100)

  return {
    unresolvedCount: unresolvedCount || 0,
    alertsToday: alertsToday || 0,
    criticalCount: criticalCount || 0,
    alerts: alerts || [],
  }
}

export default async function ErrorsPage() {
  const stats = await getSystemAlerts()

  const getAlertColor = (type: string) => {
    switch (type) {
      case 'error':
      case 'api_down':
      case 'payment_failed':
        return 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300'
      case 'anomaly':
        return 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300'
      default:
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300'
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">System Alerts & Errors</h1>
        <p className="text-muted-foreground mt-1">Monitor system health and resolve issues</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <KPITile
          title="Unresolved Alerts"
          value={stats.unresolvedCount}
          icon={AlertTriangle}
        />

        <KPITile
          title="Alerts (24h)"
          value={stats.alertsToday}
          icon={Clock}
        />

        <KPITile
          title="Critical Issues"
          value={stats.criticalCount}
          icon={XCircle}
        />
      </div>

      {/* Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Alerts</CardTitle>
          <CardDescription>System errors, anomalies, and warnings</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Message</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Time</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No alerts found
                  </TableCell>
                </TableRow>
              ) : (
                stats.alerts.map((alert: any) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge variant="secondary" className={getAlertColor(alert.type)}>
                        {alert.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground max-w-md align-top">
                      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground pr-1">
                        {alert.message}
                      </div>
                    </TableCell>
                    <TableCell>
                      {alert.resolved ? (
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-sm">Resolved</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-sm">Active</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {alert.timestamp
                        ? formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })
                        : 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {!alert.resolved && (
                        <Button variant="ghost" size="sm" className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200">
                          Resolve
                        </Button>
                      )}
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
