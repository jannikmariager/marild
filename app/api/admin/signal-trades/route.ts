import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface LiveTradeRow {
  id: number;
  signal_id: string | null;
  ticker: string;
  strategy: string;
  engine_key: string | null;
  engine_version: string | null;
  entry_timestamp: string;
  entry_price: number;
  exit_timestamp: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  realized_pnl_dollars: number | null;
  realized_pnl_r: number | null;
  size_shares: number;
  side: 'LONG' | 'SHORT' | null;
}

interface SignalRow {
  id: string;
  symbol: string;
  timeframe: string | null;
  trading_style: string | null;
  engine_type: string | null;
  signal_type: string | null;
  confidence_score: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  created_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const { searchParams } = new URL(request.url);

    const daysParam = searchParams.get('days');
    const days = Math.min(Math.max(Number(daysParam || '1'), 1), 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: trades, error: tradesError } = await supabase
      .from('live_trades')
      .select(
        'id, signal_id, ticker, strategy, engine_key, engine_version, entry_timestamp, entry_price, exit_timestamp, exit_price, exit_reason, realized_pnl_dollars, realized_pnl_r, size_shares, side',
      )
      .gte('entry_timestamp', since)
      .not('signal_id', 'is', null)
      .order('entry_timestamp', { ascending: false });

    if (tradesError) {
      console.error('[admin/signal-trades] Error fetching trades:', tradesError);
      return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
    }

    const castTrades = (trades || []) as LiveTradeRow[];

    const signalIds = Array.from(
      new Set(castTrades.map((t) => t.signal_id).filter((id): id is string => typeof id === 'string' && id.length > 0)),
    );

    let signalsById = new Map<string, SignalRow>();

    if (signalIds.length > 0) {
      const { data: signals, error: signalsError } = await supabase
        .from('ai_signals')
        .select(
          'id, symbol, timeframe, trading_style, engine_type, signal_type, confidence_score, entry_price, stop_loss, take_profit_1, take_profit_2, created_at',
        )
        .in('id', signalIds);

      if (signalsError) {
        console.error('[admin/signal-trades] Error fetching signals:', signalsError);
      } else {
        for (const row of (signals || []) as SignalRow[]) {
          signalsById.set(row.id, row);
        }
      }
    }

    const groups = Array.from(
      castTrades.reduce((acc, trade) => {
        if (!trade.signal_id) return acc;
        const key = trade.signal_id;
        const group = acc.get(key) || { signal_id: key, trades: [] as LiveTradeRow[] };
        group.trades.push(trade);
        acc.set(key, group);
        return acc;
      }, new Map<string, { signal_id: string; trades: LiveTradeRow[] }>()),
    ).map(([signalId, group]) => {
      const signal = signalsById.get(signalId) || null;
      const totalRealizedPnl = group.trades.reduce((sum, t) => sum + Number(t.realized_pnl_dollars || 0), 0);
      const totalRealizedR = group.trades.reduce((sum, t) => sum + Number(t.realized_pnl_r || 0), 0);

      return {
        signal_id: signalId,
        signal,
        trade_count: group.trades.length,
        total_realized_pnl_dollars: totalRealizedPnl,
        total_realized_pnl_r: totalRealizedR,
        trades: group.trades,
      };
    });

    return NextResponse.json({
      since,
      days,
      total_trades: castTrades.length,
      total_signals: groups.length,
      groups,
    });
  } catch (error: any) {
    console.error('[admin/signal-trades] Unexpected error:', error?.message ?? error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
