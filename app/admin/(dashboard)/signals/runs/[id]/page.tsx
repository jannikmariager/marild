import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Link from 'next/link'

function statusBadge(status: string) {
  const s = (status || '').toLowerCase()
  const cls =
    s === 'ok'
      ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
      : s === 'warn'
      ? 'border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-300'
      : 'border-red-500/40 text-red-700 bg-red-500/10 dark:text-red-300'

  return (
    <Badge variant="outline" className={cls}>
      {(status || 'unknown').toUpperCase()}
    </Badge>
  )
}

function resultBadge(resultType: string) {
  const t = (resultType || '').toLowerCase()
  const cls =
    t === 'generated'
      ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
      : t === 'deduped'
      ? 'border-blue-500/40 text-blue-700 bg-blue-500/10 dark:text-blue-300'
      : t === 'no_trade'
      ? 'border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-300'
      : 'border-red-500/40 text-red-700 bg-red-500/10 dark:text-red-300'

  return (
    <Badge variant="outline" className={cls}>
      {(resultType || 'unknown').toUpperCase()}
    </Badge>
  )
}

export default async function SignalRunDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createAdminClient()

  const { data: run, error: runError } = await supabase
    .from('signal_run_log')
    .select('*')
    .eq('id', params.id)
    .single()

  const { data: rows, error: rowsError } = await supabase
    .from('signal_run_symbol_log')
    .select('*')
    .eq('run_log_id', params.id)
    .order('result_type', { ascending: true })
    .order('symbol', { ascending: true })

  const items = (rows || []) as any[]

  const reasonCounts = items.reduce((acc, r) => {
    const key = `${r.result_type || 'unknown'}:${r.reason || 'unknown'}`
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const sortedReasons = (Object.entries(reasonCounts) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Signal Run Details</h1>
          <p className="text-muted-foreground mt-1">
            Run: <span className="font-mono text-xs">{params.id}</span>
          </p>
        </div>
        <Link
          href="/admin/signals"
          className="text-sm text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
        >
          ← Back
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run summary</CardTitle>
          <CardDescription>
            {run
              ? `${run.engine_type} ${run.timeframe} (${run.source}) at ${new Date(run.run_started_at).toISOString().replace('T', ' ').replace('Z', ' UTC')}`
              : runError
              ? `Error loading run: ${runError.message}`
              : 'Run not found'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!run ? (
            <div className="text-muted-foreground text-sm">
              {runError
                ? 'We could not load this run from the database. This usually means the schema is out of sync (e.g. different project or older table definition).'
                : 'No run found.'}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {statusBadge(run.status)}
              <span className="text-muted-foreground">Total:</span> <span className="font-medium">{run.total_symbols}</span>
              <span className="text-muted-foreground">Generated:</span> <span className="font-medium">{run.generated_count}</span>
              <span className="text-muted-foreground">Deduped:</span> <span className="font-medium">{run.deduped_count}</span>
              <span className="text-muted-foreground">No-trade:</span> <span className="font-medium">{run.no_trade_count}</span>
              <span className="text-muted-foreground">Errors:</span> <span className="font-medium">{run.error_count}</span>
              <span className="text-muted-foreground">Duration:</span> <span className="font-medium">{(run.duration_ms / 1000).toFixed(1)}s</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top reasons</CardTitle>
          <CardDescription>Most common outcomes/reasons for this run</CardDescription>
        </CardHeader>
        <CardContent>
          {rowsError ? (
            <div className="text-muted-foreground text-sm">
              Error loading per-symbol logs: {rowsError.message}
            </div>
          ) : sortedReasons.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No per-symbol logs found for this run. This usually means the current engine version was not yet writing
              per-symbol rows when this run executed, or the run belongs to a different Supabase project.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedReasons.map(([k, count]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{k}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-symbol results</CardTitle>
          <CardDescription>Every symbol processed in this run</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Symbol</TableHead>
                <TableHead className="text-muted-foreground">Result</TableHead>
                <TableHead className="text-muted-foreground">Decision</TableHead>
                <TableHead className="text-muted-foreground">Reason</TableHead>
                <TableHead className="text-muted-foreground text-right">Minutes ago</TableHead>
                <TableHead className="text-muted-foreground">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No per-symbol rows.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.symbol}</TableCell>
                    <TableCell>{resultBadge(r.result_type)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.decision || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[420px]">
                      {r.reason || '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {r.minutes_ago != null ? Number(r.minutes_ago).toFixed(1) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[420px]">
                      {r.error_message || '-'}
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
