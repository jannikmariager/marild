import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle, CheckCircle2, Clock, AlertTriangle, Zap } from 'lucide-react'

async function getDebugInfo() {
  const supabase = await createAdminClient()

  // Get debug summary
  const { data: debugSummary } = await supabase
    .from('private_analytics.v_signal_debug_summary')
    .select('*')
    .single()

  // Get today's generation status
  const { data: todayStatus } = await supabase
    .from('private_analytics.v_signal_generation_status')
    .select('*')
    .limit(30)

  // Get active alerts
  const { data: alerts } = await supabase
    .from('private_analytics.v_signal_generation_alerts')
    .select('*')

  // Get today's signals by engine
  const { data: signalsToday } = await supabase
    .from('private_analytics.v_signals_today')
    .select('*')

  // Get run timeline (last 7 days)
  const { data: timeline } = await supabase
    .from('private_analytics.v_signal_run_timeline')
    .select('*')
    .limit(7)

  return {
    debugSummary: debugSummary || {},
    todayStatus: todayStatus || [],
    alerts: alerts || [],
    signalsToday: signalsToday || [],
    timeline: timeline || [],
  }
}

export default async function SignalDebugPage() {
  const debug = await getDebugInfo()
  const summary = debug.debugSummary

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'Healthy':
        return 'text-emerald-700 dark:text-emerald-300'
      case 'No signals today':
        return 'text-amber-700 dark:text-amber-300'
      case 'Last run failed':
        return 'text-red-700 dark:text-red-300'
      case 'High errors':
        return 'text-red-700 dark:text-red-300'
      default:
        return 'text-muted-foreground'
    }
  }

  const getRunHealthColor = (health: string) => {
    if (!health) return 'text-muted-foreground'
    if (health.includes('Healthy')) return 'text-emerald-600 dark:text-emerald-400'
    if (health.includes('Normal') || health.includes('Market Assessment')) return 'text-blue-600 dark:text-blue-400'
    if (health.includes('Low')) return 'text-amber-600 dark:text-amber-400'
    if (health.includes('Error') || health.includes('error')) return 'text-red-600 dark:text-red-400'
    return 'text-muted-foreground'
  }

  const hasAnomalies = debug.alerts.length > 0 || summary.overall_health !== 'Healthy'

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Signal Generation Debug</h1>
          <p className="text-muted-foreground mt-1">Real-time monitoring of signal generation pipeline</p>
        </div>
      </div>

      {/* Alerts */}
      {hasAnomalies && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" />
              Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {debug.alerts.map((alert: any, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded border border-amber-500/20 bg-amber-500/10">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium text-amber-700 dark:text-amber-300">{alert.alert_type}</div>
                    <div className="text-sm text-muted-foreground mt-1">{alert.description}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      <strong>Action:</strong> {alert.remediation}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-amber-600 border-amber-500/40 bg-amber-500/10">
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overall Health Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Overall Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Today’s Activity */}
            <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
              <div className="text-sm font-medium text-muted-foreground">Today&rsquo;s Generation</div>
              
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-foreground">{summary.signals_today || 0}</div>
                <div className="text-sm text-muted-foreground">signals created</div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                <div>
                  <div className="text-xs text-muted-foreground">BUY Signals</div>
                  <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                    {summary.buy_signals_today || 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">SELL Signals</div>
                  <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                    {summary.sell_signals_today || 0}
                  </div>
                </div>
              </div>

              {summary.signals_yesterday !== undefined && (
                <div className="pt-2 border-t text-xs">
                  <span className="text-muted-foreground">Yesterday: </span>
                  <span className="font-medium">{summary.signals_yesterday} signals</span>
                </div>
              )}
            </div>

            {/* Last Run Status */}
            <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
              <div className="text-sm font-medium text-muted-foreground">Last Signal Run</div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20">Time:</span>
                  <span className="font-mono text-sm">
                    {summary.last_run_time ? new Date(summary.last_run_time).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'Never'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20">Status:</span>
                  <Badge
                    variant="outline"
                    className={
                      summary.last_run_status === 'ok'
                        ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
                        : summary.last_run_status === 'warn'
                        ? 'border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-300'
                        : 'border-red-500/40 text-red-700 bg-red-500/10 dark:text-red-300'
                    }
                  >
                    {(summary.last_run_status || 'unknown').toUpperCase()}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                  <div>
                    <div className="text-muted-foreground">Generated</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {summary.last_run_generated || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">No-Trade</div>
                    <div className="font-semibold text-blue-600 dark:text-blue-400">
                      {summary.last_run_no_trade || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Errors</div>
                    <div className="font-semibold text-red-600 dark:text-red-400">
                      {summary.last_run_errors || 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Overall Health Indicator */}
          <div className="mt-6 p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3">
              {summary.overall_health === 'Healthy' ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              )}
              <div>
                <div className="text-sm text-muted-foreground">Health Status</div>
                <div className={`text-lg font-semibold ${getHealthColor(summary.overall_health || 'Unknown')}`}>
                  {summary.overall_health || 'Unknown'}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signals by Engine (Today) */}
      {debug.signalsToday.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Signals by Engine (Today)</CardTitle>
            <CardDescription>Signal breakdown by engine type</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-muted-foreground">Engine</TableHead>
                  <TableHead className="text-muted-foreground text-right">Total</TableHead>
                  <TableHead className="text-muted-foreground text-right">BUY</TableHead>
                  <TableHead className="text-muted-foreground text-right">SELL</TableHead>
                  <TableHead className="text-muted-foreground text-right">Avg Confidence</TableHead>
                  <TableHead className="text-muted-foreground text-right">Symbols</TableHead>
                  <TableHead className="text-muted-foreground">First Signal</TableHead>
                  <TableHead className="text-muted-foreground">Last Signal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debug.signalsToday.map((sig: any) => (
                  <TableRow key={`${sig.signal_date}-${sig.engine_type}`}>
                    <TableCell className="font-medium">{sig.engine_type}</TableCell>
                    <TableCell className="text-right font-semibold">{sig.total_signals}</TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{sig.buy_signals}</TableCell>
                    <TableCell className="text-right text-red-600 dark:text-red-400">{sig.sell_signals}</TableCell>
                    <TableCell className="text-right text-amber-600 dark:text-amber-400">{sig.avg_confidence}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">{sig.unique_symbols}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {sig.first_signal_time ? new Date(sig.first_signal_time).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      }) + ' UTC' : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {sig.last_signal_time ? new Date(sig.last_signal_time).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      }) + ' UTC' : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Engine Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Engine Runs
          </CardTitle>
          <CardDescription>Last 30 signal generation runs</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Run Time (UTC)</TableHead>
                <TableHead className="text-muted-foreground">Engine</TableHead>
                <TableHead className="text-muted-foreground text-right">Generated</TableHead>
                <TableHead className="text-muted-foreground text-right">Deduped</TableHead>
                <TableHead className="text-muted-foreground text-right">No-Trade</TableHead>
                <TableHead className="text-muted-foreground text-right">Errors</TableHead>
                <TableHead className="text-muted-foreground text-right">Duration</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debug.todayStatus.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No engine runs recorded
                  </TableCell>
                </TableRow>
              ) : (
                debug.todayStatus.map((run: any) => (
                  <TableRow key={run.run_id}>
                    <TableCell className="text-sm font-mono">
                      {run.run_started_at ? new Date(run.run_started_at).toISOString().replace('T', ' ').slice(0, -5) : '-'}
                    </TableCell>
                    <TableCell className="font-medium">{run.engine_type}</TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{run.generated_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{run.deduped_count}</TableCell>
                    <TableCell className="text-right text-blue-600 dark:text-blue-400">{run.no_trade_count}</TableCell>
                    <TableCell className="text-right text-red-600 dark:text-red-400">{run.error_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {run.duration_ms ? (run.duration_ms / 1000).toFixed(1) + 's' : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          run.status === 'ok'
                            ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
                            : run.status === 'warn'
                            ? 'border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-300'
                            : 'border-red-500/40 text-red-700 bg-red-500/10 dark:text-red-300'
                        }
                      >
                        {(run.status || 'unknown').toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-sm font-medium ${getRunHealthColor(run.run_health)}`}>
                        {run.run_health || 'Unknown'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 7-Day Timeline */}
      {debug.timeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>7-Day Execution Timeline</CardTitle>
            <CardDescription>Daily signal generation health and activity</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-muted-foreground">Date</TableHead>
                  <TableHead className="text-muted-foreground">Engine</TableHead>
                  <TableHead className="text-muted-foreground text-right">Runs</TableHead>
                  <TableHead className="text-muted-foreground text-right">Generated</TableHead>
                  <TableHead className="text-muted-foreground text-right">No-Trade</TableHead>
                  <TableHead className="text-muted-foreground text-right">Errors</TableHead>
                  <TableHead className="text-muted-foreground text-right">OK</TableHead>
                  <TableHead className="text-muted-foreground text-right">WARN</TableHead>
                  <TableHead className="text-muted-foreground text-right">ERROR</TableHead>
                  <TableHead className="text-muted-foreground">Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debug.timeline.map((day: any) => (
                  <TableRow key={`${day.run_date}-${day.engine_type}`}>
                    <TableCell className="font-medium text-sm">{day.run_date}</TableCell>
                    <TableCell className="text-sm">{day.engine_type}</TableCell>
                    <TableCell className="text-right text-sm">{day.runs_per_day}</TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-medium">
                      {day.total_generated}
                    </TableCell>
                    <TableCell className="text-right text-blue-600 dark:text-blue-400">{day.total_no_trade}</TableCell>
                    <TableCell className="text-right text-red-600 dark:text-red-400">{day.total_errors}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400">{day.ok_runs}</TableCell>
                    <TableCell className="text-right text-xs text-amber-600 dark:text-amber-400">{day.warn_runs}</TableCell>
                    <TableCell className="text-right text-xs text-red-600 dark:text-red-400">{day.error_runs}</TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${getRunHealthColor(day.daily_health)}`}>
                        {day.daily_health}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
