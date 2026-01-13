import { createClient } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';
import { hasProAccess } from '@/lib/subscription/devOverride';

export const dynamic = 'force-dynamic';

/**
 * GET /api/performance/trades?limit=50&offset=0
 * Returns paginated list of simulated trades
 * PRO-only feature
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('[performance/trades] Auth error:', authError);
      return NextResponse.json({
        trades: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          has_more: false,
        },
        access: { is_locked: true },
      });
    }

    // PRO gating based on subscription tier (with DEV override)
    const { data: subStatus } = await supabase
      .from('subscription_status')
      .select('tier')
      .eq('user_id', user.id)
      .maybeSingle();


    const isPro = subStatus?.tier === 'pro';
    const hasAccess = hasProAccess(isPro);

    if (!hasAccess) {
      return NextResponse.json({
        trades: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          has_more: false,
        },
        access: { is_locked: true },
      });
    }

    const isLocked = false;

    // Fetch total count from live_trades table
    const { count, error: countError } = await supabase
      .from('live_trades')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('[performance/trades] Error counting trades:', countError);
    }

    // Fetch paginated live trades
    const { data: trades, error: tradesError } = await supabase
      .from('live_trades')
      .select('ticker, strategy, entry_timestamp, entry_price, exit_timestamp, exit_price, exit_reason, realized_pnl_dollars, realized_pnl_r, size_shares, side')
      .order('exit_timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (tradesError) {
      console.error('[performance/trades] Error fetching trades:', tradesError);
      return NextResponse.json(
        { error: 'Failed to fetch trades data' },
        { status: 500 }
      );
    }

    // Format trades for response - map live trades to expected format
    const formattedTrades = (trades || []).map((trade) => {
      const side = (trade.side || 'LONG') as 'LONG' | 'SHORT';

      // For open trades (no exit yet), we don't have a meaningful P&L %
      let pnlPct: number | null = null;

      if (trade.exit_price !== null && trade.entry_price > 0) {
        const rawPnlPct = side === 'SHORT'
          ? ((trade.entry_price - trade.exit_price) / trade.entry_price) * 100
          : ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100;

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
