import { createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Link from 'next/link'

const DECISION_LABELS: Record<string, string> = {
  OPEN: 'Traded (OPEN)',
  SKIP_EXISTING_POSITION: 'Not traded – position already open',
  SKIP_MAX_POSITIONS: 'Not traded – max positions reached',
  SKIP_RR_TOO_LOW: 'Not traded – R:R too low',
  SKIP_CAPACITY: 'Not traded – capacity / size too small',
  SKIP_STALE_ENTRY: 'Not traded – signal stale / price moved',
  SKIP_INVALID_TP: 'Not traded – invalid TP vs entry',
  SKIP_PRICE_FETCH_ERROR: 'Not traded – price fetch error',
};

function decisionBadge(decision: string | null) {
  const d = (decision || '').toUpperCase();
  const label = (DECISION_LABELS[d] ?? d) || 'UNKNOWN';

  if (d === 'OPEN') {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300 text-xs">
        {label}
      </Badge>
    );
  }

  if (d.startsWith('SKIP_')) {
    return (
      <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300 text-xs">
        {label}
      </Badge>
    );
  }

  return (
    <Badge className="bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 text-xs">
      {label}
    </Badge>
  );
}

export default async function LiveDecisionsPage() {
  const supabase = await createAdminClient();
  // eslint-disable-next-line react-hooks/purity
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Join latest decision per signal with the signal itself
  const { data, error } = await supabase
    .from('live_signal_decision_log')
    .select(
      `id, created_at, strategy, engine_type, ticker, decision, reason_code, reason_context,
       confidence_score, entry_price_signal, entry_price_at_decision, risk_reward_ratio,
       portfolio_open_positions, portfolio_allocated_notional, portfolio_equity,
       signal:ai_signals(id, timeframe, signal_type, trading_style, confidence_score, created_at)`
    )
    .gte('created_at', twentyFourHoursAgo)
    .order('created_at', { ascending: false })
    .limit(300);

  const rows = (data || []) as any[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Live Trading Decisions</h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            Last 24 hours of live trading entry decisions. Each row explains why a SWING or DAYTRADE signal was
            opened as a position or skipped by the portfolio manager.
          </p>
        </div>
        <Link
          href="/admin/signals"
          className="text-sm text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
        >
          ← Back to Signals overview
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decisions (last 24h)</CardTitle>
          <CardDescription>
            Sorted by newest first. This is the ground truth for &ldquo;why was this signal traded or not?&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Time (UTC)</TableHead>
                <TableHead className="text-muted-foreground">Symbol</TableHead>
                <TableHead className="text-muted-foreground">Style</TableHead>
                <TableHead className="text-muted-foreground">Decision</TableHead>
                <TableHead className="text-muted-foreground">Conf.</TableHead>
                <TableHead className="text-muted-foreground">R:R</TableHead>
                <TableHead className="text-muted-foreground">Portfolio</TableHead>
                <TableHead className="text-muted-foreground">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                    Failed to load decisions: {error.message}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                    No live trading decisions recorded in the last 24 hours.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const s = row.signal || {};
                  const ts = new Date(row.created_at).toISOString().replace('T', ' ').replace('Z', ' UTC');
                  const rr = row.risk_reward_ratio != null ? Number(row.risk_reward_ratio).toFixed(2) + 'R' : '—';

                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">{ts}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.ticker}
                        {s.timeframe && (
                          <span className="ml-1 text-[10px] text-muted-foreground">{s.timeframe}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.strategy}/{row.engine_type}
                      </TableCell>
                      <TableCell>{decisionBadge(row.decision)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.confidence_score != null
                          ? `${Number(row.confidence_score).toFixed(1)}%`
                          : s.confidence_score != null
                          ? `${Number(s.confidence_score).toFixed(1)}%`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{rr}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.portfolio_open_positions} pos ·
                        {' '}
                        ${Number(row.portfolio_allocated_notional || 0).toFixed(0)} / ${
                          Number(row.portfolio_equity || 0).toFixed(0)
                        }
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[420px]">
                        {row.reason_code || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
