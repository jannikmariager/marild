import { createClient } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';
import { requireActiveEntitlement } from '@/app/api/_lib/entitlement';

export const dynamic = 'force-dynamic';

type LiveTradeRow = {
  ticker: string | null;
  strategy: string | null;
  entry_timestamp: string | null;
  entry_price: number | null;
  exit_timestamp: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl_dollars: number | null;
  realized_pnl_r: number | null;
  size_shares: number | null;
  side: string | null;
};

/**
 * GET /api/performance/trades?limit=50&offset=0
 * Public preview: add public=1 to bypass entitlement checks.
 * Optional filters: ticker, outcome=win|loss, start=YYYY-MM-DD, end=YYYY-MM-DD
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const isPublicPreview = searchParams.get('public') === '1';

    if (!isPublicPreview) {
      try {
        await requireActiveEntitlement(request as any);
      } catch (resp: any) {
        if (resp instanceof Response) {
          return resp as any;
        }
        throw resp;
      }
    }

    const supabase = await createClient();

    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
    const outcome = (searchParams.get('outcome') || '').trim().toLowerCase(); // win|loss
    const start = (searchParams.get('start') || '').trim();
    const end = (searchParams.get('end') || '').trim();

    const isLocked = false;

    // Base query: closed trades only, most recent first.
    const applyFilters = (q: any) => {
      let qb = q
        .from('live_trades')
        .select(
          'ticker, strategy, entry_timestamp, entry_price, exit_timestamp, exit_price, exit_reason, realized_pnl_dollars, realized_pnl_r, size_shares, side',
          { count: 'exact' },
        )
        .not('exit_timestamp', 'is', null);

      if (ticker) {
        qb = qb.eq('ticker', ticker);
      }

      if (outcome === 'win') {
        qb = qb.gt('realized_pnl_dollars', 0);
      } else if (outcome === 'loss') {
        qb = qb.lt('realized_pnl_dollars', 0);
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        qb = qb.gte('exit_timestamp', `${start}T00:00:00.000Z`);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        qb = qb.lte('exit_timestamp', `${end}T23:59:59.999Z`);
      }

      return qb;
    };

    const base = applyFilters(supabase);

    // Fetch paginated live trades
    const { data: trades, error: tradesError, count } = await base
      .order('exit_timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (tradesError) {
      console.error('[performance/trades] Error fetching trades:', tradesError);
      return NextResponse.json(
        { error: 'Failed to fetch trades data' },
        { status: 500 }
      );
    }

    const tradeRows = (trades || []) as LiveTradeRow[];

    // Format trades for response - map live trades to expected format
    const formattedTrades = tradeRows.map((trade: LiveTradeRow) => {
      const side = (trade.side || 'LONG') as 'LONG' | 'SHORT';

      // For open trades (no exit yet), we don't have a meaningful P&L %
      let pnlPct: number | null = null;

      const entry = trade.entry_price;
      const exit = trade.exit_price;
      if (typeof exit === 'number' && Number.isFinite(exit) && typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
        const rawPnlPct = side === 'SHORT'
          ? ((entry - exit) / entry) * 100
          : ((exit - entry) / entry) * 100;

        pnlPct = Math.round(rawPnlPct * 100) / 100;
      }
      
      return {
        symbol: trade.ticker,
        timeframe: trade.strategy, // Use strategy as timeframe (DAYTRADE/SWING)
        direction: side, // LONG or SHORT
        entry_time: trade.entry_timestamp,
        entry_price: trade.entry_price,
        exit_time: trade.exit_timestamp,
        exit_price: trade.exit_price,
        result: trade.exit_reason, // TP_HIT, SL_HIT, EOD_FLATTEN, etc.
        pnl_pct: pnlPct,
        bars_held: null, // Not applicable for live trades
      };
    });

    return NextResponse.json({
      trades: formattedTrades,
      pagination: {
        limit,
        offset,
        total: count || 0,
        has_more: count ? offset + limit < count : false,
      },
      access: { is_locked: isLocked },
    });
  } catch (error) {
    console.error('[performance/trades] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
