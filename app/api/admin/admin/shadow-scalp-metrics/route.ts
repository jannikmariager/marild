import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function GET(request: NextRequest) {
  try {
    const { data: portfolioData } = await supabase
      .from('engine_portfolios')
      .select('*')
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .eq('run_mode', 'SHADOW')
      .maybeSingle();

    const { data: trades } = await supabase
      .from('engine_trades')
      .select('*')
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .order('opened_at', { ascending: false })
      .limit(500);

    const { data: openPositions } = await supabase
      .from('engine_positions')
      .select('*')
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .eq('status', 'OPEN');

    const { data: configData } = await supabase
      .from('scalp_engine_config')
      .select('max_concurrent_positions')
      .eq('is_enabled', true)
      .maybeSingle();

    const maxPositions = configData?.max_concurrent_positions || 4;
    const openCount = openPositions?.length || 0;

    const portfolio = portfolioData as any;
    const allTrades = (trades || []) as any[];
    const closedTrades = allTrades.filter(t => t.closed_at);

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
    const winCount = closedTrades.filter(t => (t.realized_pnl || 0) > 0).length;
    const lossCount = closedTrades.filter(t => (t.realized_pnl || 0) < 0).length;
    const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;

    const totalR = closedTrades.reduce((sum, t) => sum + (t.realized_r || 0), 0);
    const avgTradeR = closedTrades.length > 0 ? totalR / closedTrades.length : 0;

    const metrics = {
      total_trades: closedTrades.length,
      trades_won: winCount,
      trades_lost: lossCount,
      win_rate_pct: parseFloat(winRate.toFixed(2)),
      total_pnl: parseFloat(totalPnL.toFixed(2)),
      avg_trade_r: parseFloat(avgTradeR.toFixed(4)),
      open_positions: openCount,
      max_positions: maxPositions,
      current_equity: portfolio?.equity || 100000,
      starting_equity: portfolio?.starting_equity || 100000,
    };

    const formattedTrades = allTrades.map(t => ({
      id: t.id,
      ticker: t.ticker,
      entry_price: parseFloat(t.entry_price),
      exit_price: t.exit_price ? parseFloat(t.exit_price) : null,
      entry_time: t.opened_at,
      exit_time: t.closed_at,
      side: t.side,
      pnl_dollars: t.realized_pnl ? parseFloat(t.realized_pnl.toFixed(2)) : null,
      pnl_r: t.realized_r ? parseFloat(t.realized_r.toFixed(2)) : null,
      status: t.closed_at ? 'CLOSED' : 'OPEN',
      entry_qty: 0,
      entry_risk_pct: 0.15,
    }));

    return NextResponse.json(
      {
        status: 'ok',
        metrics,
        trades: formattedTrades,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[shadow-scalp-metrics] Error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
