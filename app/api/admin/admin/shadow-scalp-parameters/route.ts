import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function GET(request: NextRequest) {
  try {
    const { data: configData } = await supabase
      .from('scalp_engine_config')
      .select('*')
      .eq('is_enabled', true)
      .maybeSingle();

    if (!configData) {
      return NextResponse.json(
        { error: 'No active SCALP configuration' },
        { status: 404 }
      );
    }

    const { data: sizingDecisions } = await supabase
      .from('scalp_sizing_decisions')
      .select('*')
      .order('run_timestamp', { ascending: false })
      .limit(50);

    const stats = {
      total_decisions: sizingDecisions?.length || 0,
      entry_decisions: sizingDecisions?.filter(d => d.decision === 'ENTRY').length || 0,
      skip_decisions: sizingDecisions?.filter(d => d.decision === 'SKIP').length || 0,
      entry_rate: sizingDecisions?.length
        ? ((sizingDecisions.filter(d => d.decision === 'ENTRY').length / sizingDecisions.length) * 100).toFixed(1)
        : '0',
    };

    const { data: portfolio } = await supabase
      .from('engine_portfolios')
      .select('*')
      .eq('engine_key', 'SCALP')
      .eq('engine_version', 'SCALP_V1_MICROEDGE')
      .maybeSingle();

    const { data: openPositions } = await supabase
      .from('engine_positions')
      .select('*')
      .eq('engine_key', 'SCALP')
      .eq('status', 'OPEN');

    let totalRiskPct = 0;
    if (portfolio && portfolio.equity > 0 && openPositions) {
      const totalRisk = openPositions.reduce((sum: number, pos: any) => {
        const riskPerUnit = Math.abs(pos.entry_price - pos.stop_loss);
        return sum + (riskPerUnit * (pos.qty || 0));
      }, 0);
      totalRiskPct = (totalRisk / portfolio.equity) * 100;
    }

    return NextResponse.json(
      {
        config: {
          min_confidence_pct: configData.min_confidence_pct,
          risk_pct_per_trade: configData.risk_pct_per_trade,
          max_risk_pct_per_trade: configData.max_risk_pct_per_trade,
          max_total_open_risk_pct: configData.max_total_open_risk_pct,
          max_daily_loss_pct: configData.max_daily_loss_pct,
          max_concurrent_positions: configData.max_concurrent_positions,
          hard_max_positions: configData.hard_max_positions,
          max_positions_per_ticker: configData.max_positions_per_ticker,
          min_stop_distance_r: configData.min_stop_distance_r,
          atr_stop_distance_multiple: configData.atr_stop_distance_multiple,
          target_r_low: configData.target_r_low,
          target_r_default: configData.target_r_default,
          target_r_high: configData.target_r_high,
          stop_r: configData.stop_r,
          time_limit_minutes: configData.time_limit_minutes,
          overnight_force_close_utc_time: configData.overnight_force_close_utc_time,
        },
        portfolio: {
          equity: portfolio?.equity || 0,
          starting_equity: portfolio?.starting_equity || 0,
          allocated_notional: portfolio?.allocated_notional || 0,
          open_positions_count: openPositions?.length || 0,
          current_risk_pct: totalRiskPct.toFixed(3),
        },
        statistics: stats,
        recent_decisions: (sizingDecisions || [])
          .slice(0, 20)
          .map((d: any) => ({
            id: d.id,
            ticker: d.ticker,
            decision: d.decision,
            skip_reason: d.skip_reason,
            entry_price: d.entry_price,
            final_position_size: d.final_position_size,
            new_trade_risk_pct: d.new_trade_risk_pct,
            min_stop_distance_applied: d.min_stop_distance_applied,
            check_max_positions_passed: d.check_max_positions_passed,
            check_total_risk_passed: d.check_total_risk_passed,
            check_duplicate_ticker_passed: d.check_duplicate_ticker_passed,
            check_daily_loss_passed: d.check_daily_loss_passed,
            run_timestamp: d.run_timestamp,
          })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[shadow-scalp-parameters] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
