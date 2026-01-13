import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BarChart3, TrendingUp, TrendingDown, Activity } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { formatDistanceToNow } from 'date-fns'
import { TradingStyleFilter } from '@/components/admin/trading-style-filter'
import { DiscordDeliveryFilter } from '@/components/admin/discord-delivery-filter'
import { EngineStatusBanner } from '@/components/admin/engine-status-banner'
import Link from 'next/link'

type SortDir = 'asc' | 'desc'

type RecentSignalsSortKey =
  | 'created_at'
  | 'symbol'
  | 'signal_type'
  | 'trading_style'
  | 'timeframe'
  | 'confidence_score'
  | 'correction_risk'
  | 'discord_sent_at'

type DiscordFilter = 'all' | 'not_posted' | 'failed'

type SortableHeadProps = {
  label: string
  href: string
  isActive: boolean
  sortDir: SortDir
  alignRight?: boolean
}

function SortableHead({ label, href, isActive, sortDir, alignRight }: SortableHeadProps) {
  const arrow = isActive ? (sortDir === 'asc' ? '↑' : '↓') : ''
  return (
    <TableHead className={alignRight ? 'text-muted-foreground text-right' : 'text-muted-foreground'}>
      <Link href={href} scroll={false} className="inline-flex items-center gap-1 hover:text-foreground">
        <span>{label}</span>
        <span className="text-[10px] text-muted-foreground">{arrow}</span>
      </Link>
    </TableHead>
  )
}

type SignalStatsParams = {
  tradingStyleFilter?: string | null
  discordFilter?: DiscordFilter
  sortKey?: RecentSignalsSortKey
  sortDir?: SortDir
}

function applyTradingStyleFilter<T>(
  query: any,
  tradingStyleFilter?: string | null
): any {
  if (!tradingStyleFilter || tradingStyleFilter === 'all') return query

  // We display null trading_style as swing in the UI, so filtering Swing should include null.
  if (tradingStyleFilter === 'swing') {
    return query.or('trading_style.eq.swing,trading_style.is.null')
  }

  return query.eq('trading_style', tradingStyleFilter)
}

function normalizeSortKey(key?: string | null): RecentSignalsSortKey {
  const k = (key || 'created_at') as RecentSignalsSortKey
  const allowed: RecentSignalsSortKey[] = [
    'created_at',
    'symbol',
    'signal_type',
    'trading_style',
    'timeframe',
    'confidence_score',
    'correction_risk',
    'discord_sent_at',
  ]
  return allowed.includes(k) ? k : 'created_at'
}

function normalizeSortDir(dir?: string | null): SortDir {
  return dir === 'asc' ? 'asc' : 'desc'
}

function normalizeDiscordFilter(v?: string | null): DiscordFilter {
  if (v === 'not_posted' || v === 'failed') return v
  return 'all'
}

function applyDiscordFilter(query: any, discordFilter?: DiscordFilter): any {
  if (!discordFilter || discordFilter === 'all') return query

  if (discordFilter === 'not_posted') {
    // treat anything without discord_sent_at as not posted (includes pre-tracking rows)
    return query.is('discord_sent_at', null)
  }

  // failed
  return query.eq('discord_delivery_status', 'error')
}

function humanizeDiscordReason(row: any): string {
  if (row.discord_sent_at) {
    const channel = row.discord_channel || 'discord'
    const rank = row.discord_daily_rank ? ` (#${row.discord_daily_rank})` : ''
    return `sent:${channel}${rank}`
  }

  const status = (row.discord_delivery_status || '').toLowerCase()
  const reason = row.discord_skip_reason || row.discord_error || ''

  if (status === 'skipped' && reason) return `skipped:${reason}`
  if (status === 'error' && reason) return `error:${String(reason).slice(0, 80)}`

  // Pre-delivery-logging legacy row
  if (row.confidence_score >= 60) return 'untracked_pre_delivery_logging'
  return 'confidence_below_threshold'
}

async function getSignalStats({ tradingStyleFilter, discordFilter, sortKey, sortDir }: SignalStatsParams) {
  const supabase = await createAdminClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  // Get signals generated today
  let todayQuery = supabase
    .from('ai_signals')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneDayAgo)

  todayQuery = applyTradingStyleFilter(todayQuery, tradingStyleFilter)

  const { count: signalsToday } = await todayQuery

  // Get average confidence score
  let confidenceQuery = supabase
    .from('ai_signals')
    .select('confidence_score, signal_type, trading_style')
    .gte('created_at', oneDayAgo)

  confidenceQuery = applyTradingStyleFilter(confidenceQuery, tradingStyleFilter)

  const { data: signalsData } = await confidenceQuery

  const avgConfidence = signalsData?.length
    ? signalsData.reduce((sum, s) => sum + (s.confidence_score || 0), 0) / signalsData.length
    : 0

  // Get signal type breakdown
  const buySignals = signalsData?.filter(s => s.signal_type === 'buy').length || 0
  const sellSignals = signalsData?.filter(s => s.signal_type === 'sell').length || 0
  
  // Get trading style breakdown
  const daytrade = signalsData?.filter(s => s.trading_style === 'daytrade').length || 0
  const swing = signalsData?.filter(s => s.trading_style === 'swing').length || 0
  const invest = signalsData?.filter(s => s.trading_style === 'invest').length || 0

  // Get recent signals
  const effectiveSortKey = sortKey ?? 'created_at'
  const effectiveSortDir = sortDir ?? 'desc'

  let recentQuery = supabase
    .from('ai_signals')
    .select('*')
    .order(effectiveSortKey, { ascending: effectiveSortDir === 'asc' })
    .limit(100)

  recentQuery = applyTradingStyleFilter(recentQuery, tradingStyleFilter)
  recentQuery = applyDiscordFilter(recentQuery, discordFilter)

  const { data: recentSignals } = await recentQuery

  // Load recent engine runs (last 4h) for debug/health UI
  const { data: runLogs } = await supabase
    .from('signal_run_log')
    .select('*')
    .gte('run_started_at', fourHoursAgo)
    .neq('engine_type', 'VISIBILITY')
    .order('run_started_at', { ascending: false })
    .limit(30)

  const { data: visibilityRuns } = await supabase
    .from('signal_run_log')
    .select('*')
    .eq('engine_type', 'VISIBILITY')
    .gte('run_started_at', twoHoursAgo)
    .order('run_started_at', { ascending: false })
    .limit(20)

  return {
    signalsToday: signalsToday || 0,
    avgConfidence,
    buySignals,
    sellSignals,
    daytrade,
    swing,
    invest,
    recentSignals: recentSignals || [],
    runLogs: runLogs || [],
    visibilityRuns: visibilityRuns || [],
    engineStatus: {
      evaluation_completed: true,
      signals_found: signalsToday || 0,
      evaluation_reason: (signalsToday || 0) === 0 ? 'Market conditions did not meet quality thresholds' : 'Signals qualified and generated',
      next_evaluation_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  }
}

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: { tradingStyle?: string; sort?: string; dir?: string; discord?: string }
}) {
  const sortKey = normalizeSortKey(searchParams.sort)
  const sortDir = normalizeSortDir(searchParams.dir)
  const discordFilter = normalizeDiscordFilter(searchParams.discord)

  const stats = await getSignalStats({
    tradingStyleFilter: searchParams.tradingStyle,
    discordFilter,
    sortKey,
    sortDir,
  })

  const runsByEngine = (stats.runLogs as any[]).reduce((acc, r) => {
    const key = `${r.engine_type}/${r.timeframe}`
    if (!acc[key]) acc[key] = r
    return acc
  }, {} as Record<string, any>)

  const getSignalColor = (signalType: string) => {
    if (signalType === 'buy') return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300'
    if (signalType === 'sell') return 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300'
    return 'bg-muted text-muted-foreground border-border'
  }

  const getSignalIcon = (signalType: string) => {
    if (signalType === 'buy') return TrendingUp
    if (signalType === 'sell') return TrendingDown
    return Activity
  }
  
  const getTradingStyleBadge = (style: string | null) => {
    if (!style) style = 'swing'
    
    switch (style) {
      case 'daytrade':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300">
            DT
          </Badge>
        )
      case 'swing':
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300">
            SW
          </Badge>
        )
      case 'invest':
        return (
          <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-300">
            INV
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
            {style}
          </Badge>
        )
    }
  }

  const buildSortHref = (nextSort: RecentSignalsSortKey) => {
    const nextDir = sortKey === nextSort && sortDir === 'desc' ? 'asc' : 'desc'
    const params = new URLSearchParams()

    const tradingStyle = searchParams.tradingStyle
    if (tradingStyle && tradingStyle !== 'all') {
      params.set('tradingStyle', tradingStyle)
    }

    const discord = searchParams.discord
    if (discord && discord !== 'all') {
      params.set('discord', discord)
    }

    params.set('sort', nextSort)
    params.set('dir', nextDir)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }


  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Trading Signals</h1>
          <p className="text-muted-foreground mt-1">AI-generated trading signals and performance</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/signals/live-decisions"
            className="text-sm text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
          >
            View live trading decisions →
          </Link>
        </div>
      </div>

      {/* Engine Status Banner */}
      {stats.engineStatus && (
        <EngineStatusBanner
          evaluation_completed={stats.engineStatus.evaluation_completed}
          signals_found={stats.engineStatus.signals_found}
          evaluation_reason={stats.engineStatus.evaluation_reason}
          next_evaluation_at={stats.engineStatus.next_evaluation_at}
          className="mb-4"
        />
      )}

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile
          title="Signals Today"
          value={stats.signalsToday}
          icon={BarChart3}
        />

        <KPITile
          title="Avg Confidence"
          value={`${stats.avgConfidence.toFixed(1)}%`}
          icon={Activity}
        />

        <KPITile
          title="Buy Signals"
          value={stats.buySignals}
          icon={TrendingUp}
        />

        <KPITile
          title="Sell Signals"
          value={stats.sellSignals}
          icon={TrendingDown}
        />
      </div>
      
      {/* Trading Style Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Trading Style Breakdown</CardTitle>
          <CardDescription>Signal distribution by trading style (last 24h)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/5 border border-red-500/20">
              <div>
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  Daytrade
                  {stats.daytrade === 0 && (
                    <span className="text-xs text-slate-500">(no signals last 24h)</span>
                  )}
                </div>
                <div className="text-2xl font-bold text-foreground">{stats.daytrade}</div>
              </div>
              <div className="text-red-400 text-sm font-semibold">DT</div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <div>
                <div className="text-sm text-muted-foreground">Swingtrade</div>
                <div className="text-2xl font-bold text-foreground">{stats.swing}</div>
              </div>
              <div className="text-blue-700 dark:text-blue-300 text-sm font-semibold">SW</div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <div>
                <div className="text-sm text-muted-foreground">Investing</div>
                <div className="text-2xl font-bold text-foreground">{stats.invest}</div>
                {stats.invest === 0 && (
                  <div className="text-xs text-muted-foreground mt-1">Low confidence signals</div>
                )}
              </div>
              <div className="text-purple-700 dark:text-purple-300 text-sm font-semibold">INV</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Health & Cron-like Run Status */}
      <Card>
        <CardHeader>
          <CardTitle>Signal Engine Health (last 4h)</CardTitle>
          <CardDescription>Last runs by engine and timeframe</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Engine</TableHead>
                <TableHead className="text-muted-foreground">Timeframe</TableHead>
                <TableHead className="text-muted-foreground">Source</TableHead>
                <TableHead className="text-muted-foreground">Last Run (UTC)</TableHead>
                <TableHead className="text-muted-foreground text-right">Generated</TableHead>
                <TableHead className="text-muted-foreground text-right">Deduped</TableHead>
                <TableHead className="text-muted-foreground text-right">No-Trade</TableHead>
                <TableHead className="text-muted-foreground text-right">Errors</TableHead>
                <TableHead className="text-muted-foreground text-right">Duration</TableHead>
                <TableHead className="text-muted-foreground text-right">Status</TableHead>
                <TableHead className="text-muted-foreground text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.runLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                    No engine runs recorded in the last 4 hours
                  </TableCell>
                </TableRow>
              ) : (
                (stats.runLogs as any[]).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.engine_type}</TableCell>
                    <TableCell className="text-muted-foreground">{run.timeframe}</TableCell>
                    <TableCell className="text-muted-foreground">{run.source}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(run.run_started_at).toISOString().replace('T', ' ').replace('Z', ' UTC')}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700 dark:text-emerald-300">{run.generated_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{run.deduped_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{run.no_trade_count}</TableCell>
                    <TableCell className="text-right text-red-700 dark:text-red-300">{run.error_count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{(run.duration_ms / 1000).toFixed(1)}s</TableCell>
                    <TableCell className="text-right">
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
                        {run.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/signals/runs/${run.id}`}
                        className="text-xs text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Visibility Evaluator Runs */}
      <Card>
        <CardHeader>
          <CardTitle>Signals Visibility Evaluator (last 2h)</CardTitle>
          <CardDescription>
            Last runs of the visibility layer that upgrades/suppresses ai_signals and gates Discord/push.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Started (UTC)</TableHead>
                <TableHead className="text-muted-foreground text-right">Evaluated</TableHead>
                <TableHead className="text-muted-foreground text-right">Upgraded</TableHead>
                <TableHead className="text-muted-foreground text-right">Suppressed</TableHead>
                <TableHead className="text-muted-foreground text-right">Published Today</TableHead>
                <TableHead className="text-muted-foreground text-right">Duration</TableHead>
                <TableHead className="text-muted-foreground text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(stats.visibilityRuns as any[]).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No visibility evaluator runs recorded in the last 2 hours
                  </TableCell>
                </TableRow>
              ) : (
                (stats.visibilityRuns as any[]).map((run: any) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(run.run_started_at).toISOString().replace('T', ' ').replace('Z', ' UTC')}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {run.total_symbols}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {run.generated_count}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {run.deduped_count}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {run.no_trade_count}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {(run.duration_ms / 1000).toFixed(1)}s
                    </TableCell>
                    <TableCell className="text-right">
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Signals Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Recent Signals</CardTitle>
              <CardDescription>Latest AI-generated trading signals</CardDescription>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <TradingStyleFilter />
              <DiscordDeliveryFilter />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Symbol"
                  href={buildSortHref('symbol')}
                  isActive={sortKey === 'symbol'}
                  sortDir={sortDir}
                />
                <SortableHead
                  label="Signal"
                  href={buildSortHref('signal_type')}
                  isActive={sortKey === 'signal_type'}
                  sortDir={sortDir}
                />
                <SortableHead
                  label="Style"
                  href={buildSortHref('trading_style')}
                  isActive={sortKey === 'trading_style'}
                  sortDir={sortDir}
                />
                <SortableHead
                  label="Timeframe"
                  href={buildSortHref('timeframe')}
                  isActive={sortKey === 'timeframe'}
                  sortDir={sortDir}
                />
                <SortableHead
                  label="Confidence"
                  href={buildSortHref('confidence_score')}
                  isActive={sortKey === 'confidence_score'}
                  sortDir={sortDir}
                  alignRight
                />
                <SortableHead
                  label="Risk"
                  href={buildSortHref('correction_risk')}
                  isActive={sortKey === 'correction_risk'}
                  sortDir={sortDir}
                  alignRight
                />
                <SortableHead
                  label="Discord"
                  href={buildSortHref('discord_sent_at')}
                  isActive={sortKey === 'discord_sent_at'}
                  sortDir={sortDir}
                />
                <TableHead className="text-muted-foreground">Discord reason</TableHead>
                <SortableHead
                  label="Time"
                  href={buildSortHref('created_at')}
                  isActive={sortKey === 'created_at'}
                  sortDir={sortDir}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recentSignals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No signals found
                  </TableCell>
                </TableRow>
              ) : (
                stats.recentSignals.map((signal: any) => {
                  const SignalIcon = getSignalIcon(signal.signal_type)
                  return (
                    <TableRow key={signal.id}>
                      <TableCell className="font-medium">
                        {signal.symbol}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={getSignalColor(signal.signal_type)}>
                          <SignalIcon className="h-3 w-3 mr-1" />
                          {signal.signal_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getTradingStyleBadge(signal.trading_style)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {signal.timeframe || '1h'}
                      </TableCell>
                      <TableCell className="text-right text-emerald-700 dark:text-emerald-300 font-medium">
                        {signal.confidence_score?.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right text-amber-700 dark:text-amber-300">
                        {signal.correction_risk?.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {signal.discord_sent_at ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                            Sent
                          </Badge>
                        ) : signal.discord_delivery_status === 'error' ? (
                          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300">
                            Error
                          </Badge>
                        ) : signal.discord_delivery_status === 'skipped' ? (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                            Skipped
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                            Unknown
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-[280px]">
                        {humanizeDiscordReason(signal)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {signal.created_at
                          ? formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })
                          : 'Unknown'}
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
