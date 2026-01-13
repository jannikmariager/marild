import { createClient } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';
import { hasProAccess } from '@/lib/subscription/devOverride';

export const dynamic = 'force-dynamic';

/**
 * GET /api/performance/summary
 * Returns LIVE TRADING model portfolio performance summary with equity curve
 * Pulls from live_trades and live_portfolio_state tables
 * PRO-only feature
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const isPublicPreview = url.searchParams.get('public') === '1';

    const supabase = await createClient();

    // Only hit auth + subscription checks when not rendering public preview
    let hasAccess = isPublicPreview ? true : hasProAccess(false);

    if (!isPublicPreview && !hasAccess) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        hasAccess = false;
      } else {
        // Canonical tier check from users table
        const { data: profile } = await supabase
          .from('user_profile')
          .select('subscription_tier')
          .eq('user_id', user.id)
          .maybeSingle();

        const isPro = profile?.subscription_tier === 'pro';
        hasAccess = hasProAccess(isPro);
      }
    }

    if (!hasAccess) {
      return NextResponse.json({
        starting_equity: 0,
        current_equity: 0,
        total_return_pct: 0,
        max_drawdown_pct: 0,
        trades_count: 0,
        win_rate_pct: 0,
        best_trade_pct: null,
        worst_trade_pct: null,
        equity_curve: [],
        access: { is_locked: true },
      });
    }

    // Align with journal + admin: restrict to LIVE engine only (engine_key = 'SWING')
    // 1) Fetch all closed trades for LIVE SWING engine (realized P&L since inception)
    const { data: allTrades, error: tradesError } = await supabase
      .from('live_trades')
      .select('realized_pnl_dollars, exit_timestamp, exit_price, entry_price, exit_reason, side')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING')
      .order('exit_timestamp', { ascending: true });

    if (tradesError) {
      console.error('[performance/summary] Error fetching trades:', tradesError);
      return NextResponse.json(
        { error: 'Failed to fetch trades data' },
        { status: 500 }
      );
    }

    // 2) Fetch open positions for unrealized P&L (LIVE SWING engine only)
    const { data: openPositions, error: posError } = await supabase
      .from('live_positions')
      .select('unrealized_pnl_dollars')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING');

    if (posError) {
      console.error('[performance/summary] Error fetching open positions:', posError);
      return NextResponse.json(
        { error: 'Failed to fetch open positions' },
        { status: 500 }
      );
    }

    const starting_equity = 100000; // Single $100K Active Signals portfolio

    // Realized P&L from all closed trades (LIVE engine only)
    const realizedPnl = (allTrades || []).reduce(
      (sum, t) => sum + (t.realized_pnl_dollars || 0),
      0
    );

    // Unrealized P&L from open positions (LIVE engine only)
    const unrealizedPnl = (openPositions || []).reduce(
      (sum, p) => sum + (p.unrealized_pnl_dollars || 0),
      0
    );

    // Current equity is starting equity + realized + unrealized
    const current_equity = starting_equity + realizedPnl + unrealizedPnl;
    const total_return_pct = ((current_equity - starting_equity) / starting_equity) * 100;

    // Calculate trade statistics
    const cumulative_trades = allTrades?.length || 0;
    const cumulative_wins = allTrades?.filter(t => 
      t.exit_reason === 'TP_HIT' || t.exit_reason === 'TRAILING_SL_HIT' || t.realized_pnl_dollars > 0
    ).length || 0;
    
    const win_rate_pct = cumulative_trades > 0 ? (cumulative_wins / cumulative_trades) * 100 : 0;

    // Find best and worst trades
    let best_trade_pct = null;
    let worst_trade_pct = null;
    
    if (allTrades && allTrades.length > 0) {
      for (const trade of allTrades) {
        const pnl_pct = ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100 * 
                        (trade.side === 'SHORT' ? -1 : 1);
        
        if (best_trade_pct === null || pnl_pct > best_trade_pct) {
          best_trade_pct = pnl_pct;
        }
        
        if (worst_trade_pct === null || pnl_pct < worst_trade_pct) {
          worst_trade_pct = pnl_pct;
        }
      }
    }

    // Build equity curve from ALL closed trades (cumulative realized P&L over time)
    // This makes the curve ALWAYS match totals and updates instantly when trades close
    const equity_curve: Array<{ date: string; equity: number }> = [];
    let cumulativeRealizedPnl = 0;
    let max_drawdown_pct = 0;
    let peak = starting_equity;

    // Add starting point
    if (allTrades && allTrades.length > 0) {
      const firstTradeDate = new Date(allTrades[0].exit_timestamp);
      firstTradeDate.setHours(0, 0, 0, 0); // Start of first trading day
      equity_curve.push({ 
        date: firstTradeDate.toISOString(), 
        equity: starting_equity 
      });
    }

    // Add point for each closed trade (cumulative equity) and track max drawdown
    for (const trade of allTrades || []) {
      const exitDate = trade.exit_timestamp;
      if (!exitDate) continue;

      cumulativeRealizedPnl += trade.realized_pnl_dollars || 0;
      const equity = starting_equity + cumulativeRealizedPnl;

      equity_curve.push({
        date: exitDate,
        equity,
      });

      // Track max drawdown
      if (equity > peak) peak = equity;
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > max_drawdown_pct) max_drawdown_pct = drawdown;
    }

    // Add current point with unrealized P&L included
    if (equity_curve.length > 0) {
      equity_curve.push({ 
        date: new Date().toISOString(), 
        equity: current_equity 
      });
      
      // Check drawdown with current equity
      if (current_equity > peak) peak = current_equity;
      const currentDrawdown = ((peak - current_equity) / peak) * 100;
      if (currentDrawdown > max_drawdown_pct) max_drawdown_pct = currentDrawdown;
    }

    return NextResponse.json({
      starting_equity,
      current_equity,
      total_return_pct: Math.round(total_return_pct * 100) / 100,
      max_drawdown_pct: Math.round(max_drawdown_pct * 100) / 100,
      trades_count: cumulative_trades,
      win_rate_pct: Math.round(win_rate_pct * 100) / 100,
      best_trade_pct: best_trade_pct !== null ? Math.round(best_trade_pct * 100) / 100 : null,
      worst_trade_pct: worst_trade_pct !== null ? Math.round(worst_trade_pct * 100) / 100 : null,
      equity_curve,
      access: { is_locked: false },
    });
  } catch (error) {
    console.error('[performance/summary] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
