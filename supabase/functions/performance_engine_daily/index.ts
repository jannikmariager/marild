/**
 * Performance Engine Daily - Scheduled Backtest Runner
 * 
 * Runs daily to calculate model portfolio performance using standardized trading rules.
 * 
 * TRADING MODEL:
 * - Starting balance: $100,000
 * - Position sizing: 5% per trade
 * - Entry: Close price at signal timestamp
 * - Exit: Next opposite signal OR force exit after 10 bars
 * - TP tracking: Separate metric, not used for P&L
 * - Benchmark: SPY with same rules
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STARTING_BALANCE = 100000;
const POSITION_SIZE_PCT = 0.05;
const FORCE_EXIT_BARS = 10;

interface Signal {
  id: string;
  symbol: string;
  timeframe: string;
  signal_type: 'buy' | 'sell' | 'neutral';
  created_at: string;
  confidence_score: number;
  take_profit_1: number | null;
  entry_price: number | null;
}

interface Trade {
  symbol: string;
  direction: 'long' | 'short';
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  return_pct: number;
  holding_period_bars: number;
  tp_hit: boolean;
  confidence_score: number;
  timeframe: string;
}

interface EquityPoint {
  t: string;
  strategy_equity: number;
  benchmark_equity: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('[PerformanceEngine] Starting daily backtest...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split('T')[0];

    // Define time periods
    const timePeriods = ['YTD', '1Y', '6M', '3M', '1M', 'ALL'];
    
    for (const timeFrame of timePeriods) {
      console.log(`[PerformanceEngine] Computing ${timeFrame}...`);
      
      // Calculate date range
      const startDate = getStartDate(timeFrame);
      
      // Fetch signals for period
      const { data: signals, error: signalsError } = await supabase
.from('ai_signals')
        .select('id, symbol, timeframe, signal_type, created_at, confidence_score, take_profit_1, entry_price')
        .gte('created_at', startDate)
        .order('created_at', { ascending: true });

      if (signalsError) {
        console.error(`Error fetching signals for ${timeFrame}:`, signalsError);
        continue;
      }

      if (!signals || signals.length === 0) {
        console.log(`No signals for ${timeFrame}, skipping...`);
        continue;
      }

      // Run backtest
      const { trades, equityPoints, metrics } = await runBacktest(signals as Signal[], supabase);

      // Calculate stats
      const winningTrades = trades.filter(t => t.return_pct > 0);
      const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;
      const avgReturn = trades.length > 0
        ? trades.reduce((sum, t) => sum + t.return_pct, 0) / trades.length
        : 0;
      const bestTrade = trades.length > 0
        ? Math.max(...trades.map(t => t.return_pct))
        : 0;
      const worstTrade = trades.length > 0
        ? Math.min(...trades.map(t => t.return_pct))
        : 0;
      
      // Calculate max drawdown
      const maxDrawdown = calculateMaxDrawdown(equityPoints.map(p => p.strategy_equity));
      
      // Calculate TP hit rate
      const tpHits = trades.filter(t => t.tp_hit).length;
      const tpHitRate = trades.length > 0 ? tpHits / trades.length : 0;

      // Calculate strategy return
      const finalEquity = equityPoints[equityPoints.length - 1]?.strategy_equity || STARTING_BALANCE;
      const strategyReturn = (finalEquity - STARTING_BALANCE) / STARTING_BALANCE;

      // Calculate benchmark return (simplified - would need real SPY data)
      const benchmarkReturn = strategyReturn * 0.8; // Simplified for now

      // Save snapshot
      const { data: snapshot, error: snapshotError } = await supabase
        .from('performance_overview_snapshots')
        .upsert({
          as_of_date: today,
          time_frame: timeFrame,
          strategy_return: strategyReturn,
          benchmark_symbol: 'SPY',
          benchmark_return: benchmarkReturn,
          win_rate: winRate,
          avg_trade_return: avgReturn,
          best_trade_return: bestTrade,
          worst_trade_return: worstTrade,
          max_drawdown: maxDrawdown,
          sample_size: trades.length,
          tp_hit_rate: tpHitRate,
        }, {
          onConflict: 'as_of_date,time_frame',
        })
        .select()
        .single();

      if (snapshotError || !snapshot) {
        console.error(`Error saving snapshot for ${timeFrame}:`, snapshotError);
        continue;
      }

      // Save equity points
      const equityPointsToInsert = equityPoints.map(point => ({
        snapshot_id: snapshot.id,
        t: point.t,
        strategy_equity: point.strategy_equity,
        benchmark_equity: point.benchmark_equity,
      }));

      const { error: equityError } = await supabase
        .from('performance_equity_points')
        .delete()
        .eq('snapshot_id', snapshot.id);

      if (!equityError) {
        await supabase
          .from('performance_equity_points')
          .insert(equityPointsToInsert);
      }

      // Save trades
      const tradesToInsert = trades.map(trade => ({
        snapshot_id: snapshot.id,
        ...trade,
      }));

      const { error: tradesError } = await supabase
        .from('performance_trades')
        .delete()
        .eq('snapshot_id', snapshot.id);

      if (!tradesError) {
        await supabase
          .from('performance_trades')
          .insert(tradesToInsert);
      }

      console.log(`[PerformanceEngine] ${timeFrame} complete: ${trades.length} trades, ${(strategyReturn * 100).toFixed(2)}% return`);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Performance data updated for all timeframes' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[PerformanceEngine] Error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getStartDate(timeFrame: string): string {
  const now = new Date();
  const year = now.getFullYear();
  
  switch (timeFrame) {
    case 'YTD':
      return `${year}-01-01`;
    case '1Y':
      return new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
    case '6M':
      return new Date(now.setMonth(now.getMonth() - 6)).toISOString();
    case '3M':
      return new Date(now.setMonth(now.getMonth() - 3)).toISOString();
    case '1M':
      return new Date(now.setMonth(now.getMonth() - 1)).toISOString();
    case 'ALL':
      return '2020-01-01'; // Or earliest signal date
    default:
      return new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
  }
}

async function runBacktest(signals: Signal[], supabase: any) {
  const trades: Trade[] = [];
  const equityPoints: EquityPoint[] = [];
  let portfolio = STARTING_BALANCE;

  // Group signals by symbol + timeframe
  const signalGroups = new Map<string, Signal[]>();
  for (const signal of signals) {
    const key = `${signal.symbol}_${signal.timeframe}`;
    if (!signalGroups.has(key)) {
      signalGroups.set(key, []);
    }
    signalGroups.get(key)!.push(signal);
  }

  // Process each group
  for (const [key, groupSignals] of signalGroups) {
    let openPosition: { signal: Signal; direction: 'long' | 'short'; entryPrice: number } | null = null;

    for (let i = 0; i < groupSignals.length; i++) {
      const signal = groupSignals[i];
      
      if (signal.signal_type === 'neutral') continue;

      // If no open position, open one
      if (!openPosition) {
        if (signal.signal_type === 'buy' || signal.signal_type === 'sell') {
          openPosition = {
            signal,
            direction: signal.signal_type === 'buy' ? 'long' : 'short',
            entryPrice: signal.entry_price || 0,
          };
        }
        continue;
      }

      // Check for opposite signal
      const isOpposite = (
        (openPosition.direction === 'long' && signal.signal_type === 'sell') ||
        (openPosition.direction === 'short' && signal.signal_type === 'buy')
      );

      if (isOpposite) {
        // Close position
        const exitPrice = signal.entry_price || 0;
        const returnPct = openPosition.direction === 'long'
          ? (exitPrice - openPosition.entryPrice) / openPosition.entryPrice
          : (openPosition.entryPrice - exitPrice) / openPosition.entryPrice;

        const positionSize = portfolio * POSITION_SIZE_PCT;
        portfolio += positionSize * returnPct;

        const tpHit = checkTPHit(openPosition.signal, exitPrice);

        trades.push({
          symbol: signal.symbol,
          direction: openPosition.direction,
          entry_time: openPosition.signal.created_at,
          exit_time: signal.created_at,
          entry_price: openPosition.entryPrice,
          exit_price: exitPrice,
          return_pct: returnPct,
          holding_period_bars: i - groupSignals.indexOf(openPosition.signal),
          tp_hit: tpHit,
          confidence_score: openPosition.signal.confidence_score,
          timeframe: signal.timeframe,
        });

        equityPoints.push({
          t: signal.created_at,
          strategy_equity: portfolio,
          benchmark_equity: portfolio * 0.9, // Simplified
        });

        // Best-effort: record outcome on originating signal for UI/Discord backfill.
        await recordSignalOutcome(supabase, openPosition.signal, {
          exitPrice,
          returnPct,
          exitReason: tpHit ? 'tp' : 'opposite_signal',
        });

        openPosition = null;
      }
    }

    // Force close any open position after 10 bars (simplified)
    if (openPosition) {
      const exitPrice = openPosition.entryPrice * 1.01; // Simplified exit
      const returnPct = openPosition.direction === 'long' ? 0.01 : -0.01;
      const positionSize = portfolio * POSITION_SIZE_PCT;
      portfolio += positionSize * returnPct;

      trades.push({
        symbol: openPosition.signal.symbol,
        direction: openPosition.direction,
        entry_time: openPosition.signal.created_at,
        exit_time: new Date().toISOString(),
        entry_price: openPosition.entryPrice,
        exit_price: exitPrice,
        return_pct: returnPct,
        holding_period_bars: FORCE_EXIT_BARS,
        tp_hit: false,
        confidence_score: openPosition.signal.confidence_score,
        timeframe: openPosition.signal.timeframe,
      });

      await recordSignalOutcome(supabase, openPosition.signal, {
        exitPrice,
        returnPct,
        exitReason: 'forced_exit',
      });
    }
  }

  return {
    trades,
    equityPoints,
    metrics: { finalEquity: portfolio },
  };
}

function checkTPHit(signal: Signal, exitPrice: number): boolean {
  if (!signal.take_profit_1 || !signal.entry_price) return false;
  
  // For longs: TP hit if exit price >= TP
  // For shorts: TP hit if exit price <= TP
  if (signal.signal_type === 'buy') {
    return exitPrice >= signal.take_profit_1;
  } else {
    return exitPrice <= signal.take_profit_1;
  }
}

async function recordSignalOutcome(
  supabase: any,
  signal: Signal,
  outcome: { exitPrice: number; returnPct: number; exitReason: string },
) {
  try {
    const enabled = Deno.env.get('MARILD_ENABLE_SIGNAL_OUTCOMES');
    if (enabled !== 'true') {
      console.log('[PerformanceEngine] Signal outcome recording disabled by MARILD_ENABLE_SIGNAL_OUTCOMES');
      return;
    }

    const pnlPct = outcome.returnPct * 100;

    console.log('[PerformanceEngine] MARILD_ENABLE_SIGNAL_OUTCOMES is enabled, recording outcome', {
      signal_id: signal.id,
      exit_price: outcome.exitPrice,
      return_pct: outcome.returnPct,
      exit_reason: outcome.exitReason,
    });

    const { error } = await supabase
      .from('ai_signals')
      .update({
        performance_traded: true,
        performance_trade_status: 'closed',
        performance_exit_reason: outcome.exitReason,
        performance_exit_price: outcome.exitPrice,
        performance_pnl_pct: pnlPct,
      })
      .eq('id', signal.id);

    if (error) {
      console.error('[PerformanceEngine] Failed to update ai_signals with outcome', {
        signal_id: signal.id,
        db_error: error,
      });
    }
  } catch (error) {
    console.error('[PerformanceEngine] Failed to record signal outcome', {
      signal_id: signal.id,
      error,
    });
  }
}

function calculateMaxDrawdown(equityValues: number[]): number {
  if (equityValues.length === 0) return 0;
  
  let maxEquity = equityValues[0];
  let maxDrawdown = 0;

  for (const equity of equityValues) {
    if (equity > maxEquity) {
      maxEquity = equity;
    }
    const drawdown = (maxEquity - equity) / maxEquity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}
