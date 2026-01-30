/**
 * SCALP_V1_MICROEDGE Position Sizing & Exposure Limits
 * Deterministic, risk-based sizing with full audit trail
 */

export interface ScalpConfig {
  min_confidence_pct: number;
  target_r_default: number;
  target_r_low: number;
  target_r_high: number;
  stop_r: number;
  risk_pct_per_trade: number;
  max_concurrent_positions: number;
  time_limit_minutes: number;
  overnight_force_close_utc_time: string;
  is_enabled: boolean;
  // Sizing parameters
  min_stop_distance_r: number;
  atr_stop_distance_multiple: number;
  max_risk_pct_per_trade: number;
  max_total_open_risk_pct: number;
  max_positions_per_ticker: number;
  max_daily_loss_pct: number;
  hard_max_positions: number;
}

export interface SizingCalculation {
  // Input signal
  ticker: string;
  signalType: string;
  confidence: number;
  entryPrice: number;
  originalStopPrice: number;
  originalStopDistance: number;
  atr5?: number;

  // Parameters
  scalpEquity: number;
  config: Partial<ScalpConfig>;

  // Sizing computation
  riskAmountDollars: number;
  minStopDistance: number;
  atrNormalizedStopDistance: number;
  finalStopDistance: number;
  minStopDistanceApplied: boolean;

  // Position sizing
  rawPositionSize: number;
  riskCappedPositionSize: number;
  finalPositionSize: number;
  newTradeRiskPct: number;

  // Decision
  decision: 'ENTRY' | 'SKIP';
  skipReason?: string;
}

export interface ExposureCheckResult {
  canEnter: boolean;
  reason: string;
  openPositionsCount: number;
  maxOpenPositions: number;
  totalOpenRiskPct: number;
  maxTotalOpenRiskPct: number;
  dailyRealizedPnlPct: number;
  maxDailyLossPct: number;
}

/**
 * Calculate minimum stop distance to prevent oversized positions on tiny stops
 * MIN_STOP_DISTANCE = max(0.08R, 0.5 * ATR(5))
 */
export function computeMinStopDistance(
  minStopDistanceR: number,
  atrMultiple: number,
  atr5?: number,
  riskPerShare?: number
): { minStopDistance: number; atrNormalized: number } {
  // Minimum based on Risk Units
  const minInRiskUnits = minStopDistanceR * (riskPerShare || 1);

  // Minimum based on ATR
  const atrNormalized = atr5 ? atrMultiple * atr5 : 0;

  // Take the maximum
  const minStopDistance = Math.max(minInRiskUnits, atrNormalized);

  return {
    minStopDistance,
    atrNormalized,
  };
}

/**
 * Enforce minimum stop distance
 * If signal stop is smaller, widen it
 */
export function enforceMinStopDistance(
  originalStopPrice: number,
  entryPrice: number,
  minStopDistance: number
): { newStopPrice: number; applied: boolean } {
  const originalDistance = Math.abs(entryPrice - originalStopPrice);

  if (originalDistance >= minStopDistance) {
    // Original stop is acceptable
    return {
      newStopPrice: originalStopPrice,
      applied: false,
    };
  }

  // Widen the stop
  const newStopPrice =
    entryPrice > originalStopPrice
      ? entryPrice - minStopDistance // For LONG trades
      : entryPrice + minStopDistance; // For SHORT trades

  return {
    newStopPrice,
    applied: true,
  };
}

/**
 * Calculate deterministic position size
 *
 * Step 1: risk_amount = equity * risk_pct_per_trade
 * Step 2: position_size = risk_amount / stop_distance
 * Step 3: Cap by max_risk_pct_per_trade
 */
export function computePositionSize(
  scalpEquity: number,
  stopDistance: number,
  riskPctPerTrade: number,
  maxRiskPctPerTrade: number
): {
  riskAmountDollars: number;
  rawPositionSize: number;
  riskCappedPositionSize: number;
  finalPositionSize: number;
} {
  // Step 1: Risk dollars
  const riskAmountDollars = scalpEquity * (riskPctPerTrade / 100);

  // Step 2: Raw position size
  const rawPositionSize = stopDistance > 0 ? riskAmountDollars / stopDistance : 0;

  // Step 3: Risk cap
  const maxRiskDollars = scalpEquity * (maxRiskPctPerTrade / 100);
  const riskCappedPositionSize =
    rawPositionSize * stopDistance > maxRiskDollars
      ? maxRiskDollars / stopDistance
      : rawPositionSize;

  const finalPositionSize = Math.max(0, riskCappedPositionSize);

  return {
    riskAmountDollars,
    rawPositionSize,
    riskCappedPositionSize,
    finalPositionSize,
  };
}

/**
 * Calculate new trade risk as % of equity
 */
export function calculateTradeRiskPct(
  positionSize: number,
  stopDistance: number,
  scalpEquity: number
): number {
  if (scalpEquity <= 0) return 0;
  const riskDollars = positionSize * stopDistance;
  return (riskDollars / scalpEquity) * 100;
}

/**
 * Main sizing calculation orchestrator
 */
export function calculateSizing(
  signal: {
    ticker: string;
    signalType: string;
    confidence: number;
    entryPrice: number;
    stopPrice: number;
    atr5?: number;
  },
  scalpEquity: number,
  config: Partial<ScalpConfig>
): SizingCalculation {
  const originalStopDistance = Math.abs(signal.entryPrice - signal.stopPrice);

  if (originalStopDistance <= 0) {
    return {
      ticker: signal.ticker,
      signalType: signal.signalType,
      confidence: signal.confidence,
      entryPrice: signal.entryPrice,
      originalStopPrice: signal.stopPrice,
      originalStopDistance,
      atr5: signal.atr5,
      scalpEquity,
      config,
      riskAmountDollars: 0,
      minStopDistance: 0,
      atrNormalizedStopDistance: 0,
      finalStopDistance: 0,
      minStopDistanceApplied: false,
      rawPositionSize: 0,
      riskCappedPositionSize: 0,
      finalPositionSize: 0,
      newTradeRiskPct: 0,
      decision: 'SKIP',
      skipReason: 'Invalid original stop distance',
    };
  }

  // Step 1: Compute minimum stop distance
  const { minStopDistance, atrNormalized } = computeMinStopDistance(
    config.min_stop_distance_r || 0.08,
    config.atr_stop_distance_multiple || 0.5,
    signal.atr5,
    originalStopDistance
  );

  // Step 2: Enforce minimum stop distance
  const { newStopPrice, applied } = enforceMinStopDistance(
    signal.stopPrice,
    signal.entryPrice,
    minStopDistance
  );

  const finalStopDistance = Math.abs(signal.entryPrice - newStopPrice);

  // Step 3: Compute position size
  const sizing = computePositionSize(
    scalpEquity,
    finalStopDistance,
    config.risk_pct_per_trade || 0.15,
    config.max_risk_pct_per_trade || 0.20
  );

  // Step 4: Calculate new trade risk as % of equity
  const newTradeRiskPct = calculateTradeRiskPct(
    sizing.finalPositionSize,
    finalStopDistance,
    scalpEquity
  );

  return {
    ticker: signal.ticker,
    signalType: signal.signalType,
    confidence: signal.confidence,
    entryPrice: signal.entryPrice,
    originalStopPrice: signal.stopPrice,
    originalStopDistance,
    atr5: signal.atr5,
    scalpEquity,
    config,
    riskAmountDollars: sizing.riskAmountDollars,
    minStopDistance,
    atrNormalizedStopDistance: atrNormalized,
    finalStopDistance,
    minStopDistanceApplied: applied,
    rawPositionSize: sizing.rawPositionSize,
    riskCappedPositionSize: sizing.riskCappedPositionSize,
    finalPositionSize: sizing.finalPositionSize,
    newTradeRiskPct,
    decision: 'ENTRY',
  };
}

/**
 * Log sizing decision to database
 */
export async function logSizingDecision(
  supabase: any,
  sizing: SizingCalculation,
  exposureCheck: ExposureCheckResult,
  signalId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('scalp_sizing_decisions')
      .insert({
        signal_id: signalId,
        ticker: sizing.ticker,
        signal_type: sizing.signalType,
        confidence_score: sizing.confidence,
        entry_price: sizing.entryPrice,
        original_stop_distance: sizing.originalStopDistance,
        scalp_equity: sizing.scalpEquity,
        risk_pct_per_trade: sizing.config.risk_pct_per_trade || 0.15,
        risk_amount_dollars: sizing.riskAmountDollars,
        min_stop_distance_requirement: sizing.minStopDistance,
        atr_5: sizing.atr5,
        atr_normalized_stop_distance: sizing.atrNormalizedStopDistance,
        raw_position_size: sizing.rawPositionSize,
        risk_capped_position_size: sizing.riskCappedPositionSize,
        final_position_size: sizing.finalPositionSize,
        open_positions_count: exposureCheck.openPositionsCount,
        max_open_positions: exposureCheck.maxOpenPositions,
        check_max_positions_passed: exposureCheck.openPositionsCount < exposureCheck.maxOpenPositions,
        total_open_risk_pct_before: exposureCheck.totalOpenRiskPct,
        max_total_open_risk_pct: exposureCheck.maxTotalOpenRiskPct,
        new_trade_risk_pct: sizing.newTradeRiskPct,
        check_total_risk_passed:
          exposureCheck.totalOpenRiskPct + sizing.newTradeRiskPct <=
          exposureCheck.maxTotalOpenRiskPct,
        existing_position_for_ticker: !exposureCheck.canEnter,
        check_duplicate_ticker_passed: exposureCheck.canEnter,
        daily_realized_pnl_pct: exposureCheck.dailyRealizedPnlPct,
        max_daily_loss_pct: exposureCheck.maxDailyLossPct,
        check_daily_loss_passed:
          exposureCheck.dailyRealizedPnlPct > exposureCheck.maxDailyLossPct,
        decision: sizing.decision,
        skip_reason: sizing.skipReason,
        run_timestamp: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[scalp-sizing-utils] Log error:', error);
      return null;
    }

    return (data as any)?.id || null;
  } catch (error) {
    console.error('[scalp-sizing-utils] Unexpected log error:', error);
    return null;
  }
}

/**
 * Format sizing decision for logging
 */
export function formatSizingLog(sizing: SizingCalculation): string {
  return `
[SCALP_SIZING] ${sizing.ticker}
  Decision: ${sizing.decision}${sizing.skipReason ? ` (${sizing.skipReason})` : ''}
  Entry: $${sizing.entryPrice.toFixed(4)} | Stop: ${sizing.minStopDistanceApplied ? '📐 adjusted' : 'original'}
  Equity: $${sizing.scalpEquity.toFixed(0)} | Risk: ${sizing.config.risk_pct_per_trade}%
  Position Size: ${sizing.finalPositionSize.toFixed(4)} | New Risk: ${sizing.newTradeRiskPct.toFixed(3)}%
  Stop Distance: ${sizing.finalStopDistance.toFixed(4)} (min required: ${sizing.minStopDistance.toFixed(4)})
  `;
}
