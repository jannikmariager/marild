// SCALP_V1_MICROEDGE Signal Executor
// Consumes SWING signals, executes 0.15-0.30R micro-edge trades with deterministic sizing
// Run schedule: Every 2-5 minutes during market hours

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import {
  calculateSizing,
  logSizingDecision,
  formatSizingLog,
  type ExposureCheckResult,
  type ScalpConfig,
} from '../_shared/scalp-sizing-utils.ts';
import { executeScalpEntry } from '../_shared/scalp-execution.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExecutionDecision {
  type: 'ENTRY' | 'SKIP';
  reason: string;
  signal_id?: string;
  trade_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const runStartTime = Date.now();
  const HARD_TIMEOUT_MS = 20000;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), HARD_TIMEOUT_MS);
  console.log('[scalp_signal_executor] Starting SCALP_V1_MICROEDGE execution scan');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Load SCALP config
    const { data: configData, error: configError } = await supabase
      .from('scalp_engine_config')
      .select('*')
      .eq('is_enabled', true)
      .maybeSingle();

    if (configError || !configData) {
      throw new Error(`Failed to load SCALP config: ${configError?.message || 'No active config'}`);
    }

    const config = configData as any;
    console.log(`[scalp_signal_executor] Config: min_conf=${config.min_confidence_pct}%, target=${config.target_r_default}R`);

    // Get SCALP portfolio
    const { data: portfolioData, error: portfolioError } = await supabase
      .from('engine_portfolios')
      .select('*')
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .eq('run_mode', 'SHADOW')
      .maybeSingle();

    if (portfolioError || !portfolioData) {
      throw new Error(`Failed to load SCALP portfolio: ${portfolioError?.message || 'Not found'}`);
    }

    const portfolio = portfolioData as any;
    const scalpEquity = portfolio.equity || 100000;
    console.log(`[scalp_signal_executor] SCALP equity: $${scalpEquity.toFixed(2)}`);

    // Count open SCALP positions
    const { count: openCount, error: countError } = await supabase
      .from('engine_positions')
      .select('*', { count: 'exact', head: true })
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .eq('run_mode', 'SHADOW')
      .eq('status', 'OPEN');

    if (countError) {
      throw new Error(`Failed to count positions: ${countError.message}`);
    }

    const openPositions = openCount || 0;
    console.log(`[scalp_signal_executor] Open positions: ${openPositions}/${config.hard_max_positions}`);

    // Check daily loss stop
    const dailyPnl = await getScalpDailyPnl(supabase);
    const dailyPnlPct = scalpEquity > 0 ? (dailyPnl / scalpEquity) * 100 : 0;

    if (dailyPnlPct <= (config.max_daily_loss_pct || -0.75)) {
      console.log(`[scalp_signal_executor] Daily loss limit hit (${dailyPnlPct.toFixed(2)}%), disabling SCALP`);
      return new Response(
        JSON.stringify({
          status: 'disabled',
          reason: 'daily_loss_stop',
          daily_pnl_pct: dailyPnlPct,
          max_daily_loss_pct: config.max_daily_loss_pct || -0.75,
          decisions: [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch NEW SWING signals
    const { data: signalsData, error: signalsError } = await supabase
      .from('ai_signals')
      .select('id, symbol, timeframe, signal_type, confidence_score, entry_price, stop_loss, take_profit_1, created_at')
      .gte('confidence_score', config.min_confidence_pct)
      .gt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (signalsError) {
      throw new Error(`Failed to fetch SWING signals: ${signalsError.message}`);
    }

    console.log(`[scalp_signal_executor] Found ${signalsData?.length || 0} qualifying signals`);

    const decisions: ExecutionDecision[] = [];

    // Process signals with sizing
    for (const signal of signalsData || []) {
      // Calculate sizing
      const sizing = calculateSizing(
        {
          ticker: signal.symbol,
          signalType: signal.signal_type || 'BUY',
          confidence: signal.confidence_score,
          entryPrice: signal.entry_price,
          stopPrice: signal.stop_loss,
          atr5: undefined, // Would fetch from market data service
        },
        scalpEquity,
        config
      );

      // Check exposure limits
      const exposureCheck = await checkExposureLimits(
        supabase,
        signal.symbol,
        sizing.newTradeRiskPct,
        config,
        dailyPnlPct
      );

      // Log sizing decision
      const sizingDecisionId = await logSizingDecision(
        supabase,
        sizing,
        exposureCheck,
        signal.id
      );

      console.log(formatSizingLog(sizing));

      // Determine final decision
      let shouldEnter = exposureCheck.canEnter && sizing.finalPositionSize > 0;
      let skipReason = '';

      if (!exposureCheck.canEnter) {
        shouldEnter = false;
        skipReason = exposureCheck.reason;
      }

      if (!shouldEnter) {
        console.log(
          `[scalp_signal_executor] SKIP ${signal.symbol} - ${skipReason || 'sizing check failed'}`
        );
        decisions.push({
          type: 'SKIP',
          reason: skipReason || 'exposure_limit',
          signal_id: signal.id,
        });
        continue;
      }

      // Execute entry
      console.log(
        `[scalp_signal_executor] ENTERING ${signal.symbol} (conf=${signal.confidence_score}%, size=${sizing.finalPositionSize.toFixed(4)})`
      );
      const result = await executeScalpEntry(
        supabase,
        signal,
        config,
        sizing,
        sizingDecisionId
      );

      if (result) {
        decisions.push({
          type: 'ENTRY',
          reason: 'entry_executed',
          signal_id: signal.id,
          trade_id: result.trade_id,
        });
      } else {
        decisions.push({
          type: 'SKIP',
          reason: 'entry_execution_failed',
          signal_id: signal.id,
        });
      }
    }

    const runDurationMs = Date.now() - runStartTime;
    console.log(`[scalp_signal_executor] Complete: ${decisions.filter(d => d.type === 'ENTRY').length} entries (${(runDurationMs / 1000).toFixed(1)}s)`);

    return new Response(
      JSON.stringify({
        status: 'completed',
        timestamp: new Date().toISOString(),
        open_positions: openPositions,
        max_positions: config.hard_max_positions,
        decisions_made: decisions.length,
        entries: decisions.filter(d => d.type === 'ENTRY').length,
        skips: decisions.filter(d => d.type === 'SKIP').length,
        duration_ms: runDurationMs,
        daily_pnl_pct: dailyPnlPct,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[scalp_signal_executor] Fatal error:', error);
    return new Response(
      JSON.stringify({
        status: 'error',
        error: error.message || String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } finally {
    clearTimeout(timeout);
  }
});

/**
 * Get today's realized P&L
 */
async function getScalpDailyPnl(supabase: any): Promise<number> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('scalp_execution_log')
      .select('realized_pnl')
      .eq('status', 'CLOSED')
      .gte('exit_time', `${today}T00:00:00Z`);

    if (error) {
      console.warn('[scalp_signal_executor] Daily PnL query error:', error);
      return 0;
    }

    const total = (data || []).reduce((sum: number, trade: any) => sum + (trade.realized_pnl || 0), 0);
    return total;
  } catch (error) {
    console.warn('[scalp_signal_executor] Daily PnL calculation error:', error);
    return 0;
  }
}

/**
 * Check exposure limits before entry
 */
async function checkExposureLimits(
  supabase: any,
  ticker: string,
  newRiskPct: number,
  config: any,
  dailyPnlPct: number
): Promise<ExposureCheckResult> {
  try {
    // Get current open positions
    const { count: openCount, error: countError } = await supabase
      .from('engine_positions')
      .select('*', { count: 'exact', head: true })
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .eq('run_mode', 'SHADOW')
      .eq('status', 'OPEN');

    const openPositionsCount = openCount || 0;

    // Check 1: Hard max positions
    if (openPositionsCount >= config.hard_max_positions) {
      return {
        canEnter: false,
        reason: 'Exceeds hard max positions',
        openPositionsCount,
        maxOpenPositions: config.hard_max_positions,
        totalOpenRiskPct: 0,
        maxTotalOpenRiskPct: config.max_total_open_risk_pct,
        dailyRealizedPnlPct: dailyPnlPct,
        maxDailyLossPct: config.max_daily_loss_pct || -0.75,
      };
    }

    // Check 2: Duplicate ticker
    const { count: tickerCount } = await supabase
      .from('engine_positions')
      .select('*', { count: 'exact', head: true })
      .eq('engine_key', 'SCALP')
      .eq('ticker', ticker)
      .eq('status', 'OPEN');

    if ((tickerCount || 0) > 0) {
      return {
        canEnter: false,
        reason: 'Already has position for this ticker',
        openPositionsCount,
        maxOpenPositions: config.max_concurrent_positions,
        totalOpenRiskPct: 0,
        maxTotalOpenRiskPct: config.max_total_open_risk_pct,
        dailyRealizedPnlPct: dailyPnlPct,
        maxDailyLossPct: config.max_daily_loss_pct || -0.75,
      };
    }

    // Check 3: Total risk limit
    const { data: positions } = await supabase
      .from('engine_positions')
      .select('entry_price, stop_loss, qty')
      .eq('engine_key', 'SCALP')
      .eq('status', 'OPEN');

    let totalOpenRisk = 0;
    (positions || []).forEach((pos: any) => {
      const riskPerUnit = Math.abs(pos.entry_price - pos.stop_loss);
      totalOpenRisk += riskPerUnit * (pos.qty || 0);
    });

    const { data: portfolio } = await supabase
      .from('engine_portfolios')
      .select('equity')
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .eq('run_mode', 'SHADOW')
      .maybeSingle();

    const equity = (portfolio as any)?.equity || 100000;
    const totalOpenRiskPct = equity > 0 ? (totalOpenRisk / equity) * 100 : 0;

    if (totalOpenRiskPct + newRiskPct > (config.max_total_open_risk_pct || 0.45)) {
      return {
        canEnter: false,
        reason: 'Would exceed total risk limit',
        openPositionsCount,
        maxOpenPositions: config.max_concurrent_positions,
        totalOpenRiskPct,
        maxTotalOpenRiskPct: config.max_total_open_risk_pct,
        dailyRealizedPnlPct: dailyPnlPct,
        maxDailyLossPct: config.max_daily_loss_pct || -0.75,
      };
    }

    // All checks passed
    return {
      canEnter: true,
      reason: 'OK',
      openPositionsCount,
      maxOpenPositions: config.max_concurrent_positions,
      totalOpenRiskPct,
      maxTotalOpenRiskPct: config.max_total_open_risk_pct,
      dailyRealizedPnlPct: dailyPnlPct,
      maxDailyLossPct: config.max_daily_loss_pct || -0.75,
    };
  } catch (error) {
    console.error('[scalp_signal_executor] Exposure check error:', error);
    return {
      canEnter: false,
      reason: 'Exposure check failed',
      openPositionsCount: 0,
      maxOpenPositions: config.hard_max_positions,
      totalOpenRiskPct: 0,
      maxTotalOpenRiskPct: config.max_total_open_risk_pct,
      dailyRealizedPnlPct: dailyPnlPct,
      maxDailyLossPct: config.max_daily_loss_pct || -0.75,
    };
  }

}