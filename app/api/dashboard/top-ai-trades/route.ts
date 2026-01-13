import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEFAULT_LOOKBACK_DAYS = 7;
const CACHE_TTL_SECONDS = 300; // 5 minutes

export type TopAiTradeDto = {
  id: string;
  ticker: string;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  entry_price: number | null;
  exit_price: number | null;
  realized_return: number | null; // percentage
  r_multiple: number | null;
  duration_to_outcome: string | null; // e.g. "3h", "1d"
  outcome_type: 'TP' | 'SL' | 'OTHER' | null;
  closed_at: string | null;
};

async function getApprovedUniverseTickers(supabase: any): Promise<string[]> {
  const { data, error } = await supabase
    .from('engine_universe')
    .select('universe_name, tickers')
    .in('universe_name', ['performance_day', 'performance_swing', 'performance_invest']);

  if (error) {
    console.error('[top-ai-trades] failed to load engine_universe:', error);
    return [];
  }

  const set = new Set<string>();

  for (const row of data || []) {
    const tickers: string[] = (row.tickers as string[]) || [];
    tickers.forEach((t) => {
      if (t) set.add(String(t).toUpperCase());
    });
  }

  return Array.from(set);
}

export async function getTopAiTrades(lookbackDays: number = DEFAULT_LOOKBACK_DAYS): Promise<TopAiTradeDto[]> {
  const supabase = await createClient();

  // We still respect the approved performance universes if present,
  // but we no longer *require* them to show trades. If the universe
  // is empty we fall back to all live_trades.
  const approvedTickers = await getApprovedUniverseTickers(supabase);

  const now = new Date();
  const from = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  let query = supabase
    .from('live_trades')
    .select('*')
    .gte('exit_timestamp', from.toISOString())
    .not('exit_timestamp', 'is', null);

  if (approvedTickers.length > 0) {
    query = query.in('ticker', approvedTickers);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[top-ai-trades] error querying live_trades:', error);
    return [];
  }

  const trades: TopAiTradeDto[] = (data || [])
    .map((row: any) => {
      const direction: 'LONG' | 'SHORT' = row.side === 'SHORT' ? 'SHORT' : 'LONG';

      const entry = row.entry_price != null ? Number(row.entry_price) : null;
      const exit = row.exit_price != null ? Number(row.exit_price) : null;

      let realized_return: number | null = null;
      if (entry && exit) {
        const rawPct = ((exit - entry) / entry) * 100;
        realized_return = direction === 'SHORT' ? -rawPct : rawPct;
      }

      const r_multiple = row.realized_pnl_r != null ? Number(row.realized_pnl_r) : null;

      let outcome_type: 'TP' | 'SL' | 'OTHER' | null = null;
      if (row.exit_reason === 'TP_HIT') outcome_type = 'TP';
      else if (row.exit_reason === 'SL_HIT') outcome_type = 'SL';
      else if (row.exit_reason) outcome_type = 'OTHER';

      const createdAt = row.entry_timestamp ? new Date(row.entry_timestamp) : null;
      const closedAt = row.exit_timestamp ? new Date(row.exit_timestamp) : createdAt;

      let duration_to_outcome: string | null = null;
      if (createdAt && closedAt) {
        const minutes = Math.max(1, Math.round((closedAt.getTime() - createdAt.getTime()) / 60000));
        if (minutes < 60) {
          duration_to_outcome = `${minutes}m`;
        } else {
          const hours = minutes / 60;
          if (hours < 24) {
            const h = Math.round(hours * 10) / 10;
            duration_to_outcome = `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)}h`;
          } else {
            const days = Math.round(hours / 24);
            duration_to_outcome = `${days}d`;
          }
        }
      }

      return {
        id: String(row.id),
        ticker: row.ticker,
        direction,
        timeframe: row.strategy || 'N/A',
        entry_price: entry,
        exit_price: exit,
        realized_return,
        r_multiple,
        duration_to_outcome,
        outcome_type,
        closed_at: closedAt ? closedAt.toISOString() : null,
      };
    })
    // Only keep true winners for this "Top" widget: positive return and not SL exits.
    .filter(
      (t) =>
        t.realized_return !== null &&
        t.realized_return > 0 &&
        t.entry_price !== null &&
        t.exit_price !== null &&
        t.outcome_type !== 'SL'
    );

  // Sort by performance, then by recency.
  trades.sort((a, b) => {
    const r = (b.realized_return || 0) - (a.realized_return || 0);
    if (r !== 0) return r;
    const aTime = a.closed_at ? new Date(a.closed_at).getTime() : 0;
    const bTime = b.closed_at ? new Date(b.closed_at).getTime() : 0;
    return bTime - aTime;
  });

  // De-duplicate by ticker so the list is easier to scan.
  const seen = new Set<string>();
  const unique: TopAiTradeDto[] = [];
  for (const t of trades) {
    if (seen.has(t.ticker)) continue;
    seen.add(t.ticker);
    unique.push(t);
    if (unique.length >= 5) break;
  }

  return unique;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const lookbackParam = url.searchParams.get('lookbackDays');
    const lookbackDays = lookbackParam ? Math.max(1, parseInt(lookbackParam, 10) || DEFAULT_LOOKBACK_DAYS) : DEFAULT_LOOKBACK_DAYS;

    const trades = await getTopAiTrades(lookbackDays);

    return NextResponse.json(
      { trades },
      {
        headers: {
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS}`,
        },
      }
    );
  } catch (error: any) {
    console.error('[top-ai-trades] GET error:', error);
    return NextResponse.json(
      { error: 'SYSTEM_ERROR', message: error.message || 'Failed to load top AI trades' },
      { status: 500 }
    );
  }
}
