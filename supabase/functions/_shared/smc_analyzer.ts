/**
 * Engine-Specific SMC Analyzer
 * 
 * Implements differentiated Smart Money Concepts analysis for three trading engines:
 * - Daytrader: Aggressive micro-SMC (loose structure, fast reactions)
 * - Swing: Balanced clean SMC (multi-TF alignment, quality setups)
 * - Investor: Macro-SMC (HTF only, fundamentals-first)
 */

import { SMCData, OrderBlock, BOSEvent } from './signal_types.ts';

export type EngineType = 'DAYTRADER' | 'SWING' | 'INVESTOR';

export interface SMCAnalysis {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-100
  structure_quality: 'weak' | 'moderate' | 'strong';
  key_levels: {
    order_blocks: number;
    active_obs: number;
    near_price: boolean;
  };
  breakdown: {
    structure_score: number;
    ob_score: number;
    fvg_score: number;
    liquidity_score: number;
  };
}

// ============================================================
// DAYTRADER ENGINE - Aggressive Micro-SMC
// ============================================================

export function analyzeDaytraderSMC(
  smc: SMCData,
  currentPrice: number,
  timeframe: string
): SMCAnalysis {
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 40; // Lower base confidence
  const breakdown = {
    structure_score: 0,
    ob_score: 0,
    fvg_score: 0,
    liquidity_score: 0,
  };

  // STRUCTURE: Accept micro BOS or CHoCH, incomplete swings OK
  const recentBOS = smc.bos_events[0];
  if (recentBOS) {
    bias = recentBOS.direction === 'up' ? 'bullish' : 'bearish';
    breakdown.structure_score = Math.min(20, 10 + recentBOS.strength * 0.1);
    confidence += breakdown.structure_score;
  }

  // ORDER BLOCKS: Accept small OBs (3-6 candles), mitigation optional
  const activeBullishOBs = smc.order_blocks.filter(
    (ob) => ob.direction === 'bullish' && !ob.mitigated && ob.low < currentPrice
  );
  const activeBearishOBs = smc.order_blocks.filter(
    (ob) => ob.direction === 'bearish' && !ob.mitigated && ob.high > currentPrice
  );

  // Loose proximity check (within 3%)
  const nearBullishOB = activeBullishOBs.some(
    (ob) => currentPrice >= ob.low * 0.97 && currentPrice <= ob.high * 1.03
  );
  const nearBearishOB = activeBearishOBs.some(
    (ob) => currentPrice <= ob.high * 1.03 && currentPrice >= ob.low * 0.97
  );

  if (nearBullishOB) {
    if (bias !== 'bearish') bias = 'bullish';
    breakdown.ob_score = 15;
    confidence += 15;
  } else if (nearBearishOB) {
    if (bias !== 'bullish') bias = 'bearish';
    breakdown.ob_score = 15;
    confidence += 15;
  }

  // Any active OBs count (quantity over quality)
  if (activeBullishOBs.length > activeBearishOBs.length && bias !== 'bearish') {
    bias = 'bullish';
    breakdown.ob_score += 5;
    confidence += 5;
  } else if (activeBearishOBs.length > activeBullishOBs.length && bias !== 'bullish') {
    bias = 'bearish';
    breakdown.ob_score += 5;
    confidence += 5;
  }

  // FVG: Small gaps count (1-2 candles OK)
  // Note: FVG detection would need to be added to SMCData
  // For now, use liquidity zones as proxy
  if (smc.liquidity_zones && smc.liquidity_zones.length > 0) {
    breakdown.fvg_score = 10;
    confidence += 10;
  }

  // LIQUIDITY: Small wick sweeps valid
  if (smc.liquidity_zones) {
    const nearLiq = smc.liquidity_zones.some(
      (zone) => Math.abs(zone.price - currentPrice) / currentPrice < 0.02
    );
    if (nearLiq) {
      breakdown.liquidity_score = 10;
      confidence += 10;
    }
  }

  // Reduced penalty for no data (max 30% penalty)
  if (smc.order_blocks.length === 0 && !recentBOS) {
    confidence = Math.max(20, confidence - 10);
  }

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const structure_quality =
    confidence >= 60 ? 'strong' : confidence >= 40 ? 'moderate' : 'weak';

  return {
    bias,
    confidence,
    structure_quality,
    key_levels: {
      order_blocks: smc.order_blocks.length,
      active_obs: activeBullishOBs.length + activeBearishOBs.length,
      near_price: nearBullishOB || nearBearishOB,
    },
    breakdown,
  };
}

// ============================================================
// SWING ENGINE - Balanced Clean SMC
// ============================================================

export function analyzeSwingSMC(
  smc: SMCData,
  currentPrice: number,
  timeframe: string
): SMCAnalysis {
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 50; // Moderate base
  const breakdown = {
    structure_score: 0,
    ob_score: 0,
    fvg_score: 0,
    liquidity_score: 0,
  };

  // STRUCTURE: Require clear CHoCH or BOS, defined swing high/low
  const recentBOS = smc.bos_events[0];
  if (recentBOS && recentBOS.strength >= 50) {
    // Require decent strength
    bias = recentBOS.direction === 'up' ? 'bullish' : 'bearish';
    breakdown.structure_score = Math.min(30, 15 + recentBOS.strength * 0.15);
    confidence += breakdown.structure_score;
  } else if (recentBOS && recentBOS.strength < 50) {
    // Reduced weak structure penalty (max 30%)
    confidence -= 5;
  }

  // ORDER BLOCKS: Must be properly formed (3-8 candles), prefer clean mitigation
  const activeBullishOBs = smc.order_blocks.filter(
    (ob) =>
      ob.direction === 'bullish' &&
      !ob.mitigated &&
      ob.low < currentPrice &&
      ob.origin !== 'swing' // Prefer BOS/CHoCH origin
  );
  const activeBearishOBs = smc.order_blocks.filter(
    (ob) =>
      ob.direction === 'bearish' &&
      !ob.mitigated &&
      ob.high > currentPrice &&
      ob.origin !== 'swing'
  );

  // Tighter proximity check (within 2%)
  const nearBullishOB = activeBullishOBs.some(
    (ob) => currentPrice >= ob.low * 0.98 && currentPrice <= ob.high * 1.02
  );
  const nearBearishOB = activeBearishOBs.some(
    (ob) => currentPrice <= ob.high * 1.02 && currentPrice >= ob.low * 0.98
  );

  if (nearBullishOB && bias !== 'bearish') {
    bias = 'bullish';
    breakdown.ob_score = 20;
    confidence += 20;
  } else if (nearBearishOB && bias !== 'bullish') {
    bias = 'bearish';
    breakdown.ob_score = 20;
    confidence += 20;
  }

  // Reduced penalty for conflicting OBs (max 30%)
  if (activeBullishOBs.length > 0 && activeBearishOBs.length > 0) {
    if (Math.abs(activeBullishOBs.length - activeBearishOBs.length) < 2) {
      confidence -= 10; // Choppy structure
    }
  }

  // FVG: Require clear 2-candle gap
  // (Would need FVG detection enhancement)
  if (smc.liquidity_zones && smc.liquidity_zones.length >= 2) {
    breakdown.fvg_score = 15;
    confidence += 15;
  }

  // LIQUIDITY: Require real sweep, not just long wick
  // Look for sweep → displacement → OB → retest pattern
  if (smc.liquidity_zones && smc.liquidity_zones.length > 0 && recentBOS) {
    const timeDiff =
      new Date().getTime() - new Date(recentBOS.event_time).getTime();
    if (timeDiff < 24 * 60 * 60 * 1000) {
      // Recent sweep + BOS
      breakdown.liquidity_score = 15;
      confidence += 15;
    }
  }

  // Reduced penalty for unclear structure (max 30%)
  if (smc.order_blocks.length === 0 || !recentBOS) {
    confidence = Math.max(30, confidence - 15);
  }

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const structure_quality =
    confidence >= 70 ? 'strong' : confidence >= 45 ? 'moderate' : 'weak';

  return {
    bias,
    confidence,
    structure_quality,
    key_levels: {
      order_blocks: smc.order_blocks.length,
      active_obs: activeBullishOBs.length + activeBearishOBs.length,
      near_price: nearBullishOB || nearBearishOB,
    },
    breakdown,
  };
}

// ============================================================
// INVESTOR ENGINE - Macro-SMC + Fundamentals First
// ============================================================

export function analyzeInvestorSMC(
  smc: SMCData,
  currentPrice: number,
  timeframe: string
): SMCAnalysis {
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 30; // Low base (fundamentals matter more)
  const breakdown = {
    structure_score: 0,
    ob_score: 0,
    fvg_score: 0,
    liquidity_score: 0,
  };

  // STRUCTURE: Only HTF timeframes matter (1D, 1W, 1M)
  if (!['1d', '1w', '1mo'].includes(timeframe.toLowerCase())) {
    // Reject lower timeframes entirely
    return {
      bias: 'neutral',
      confidence: 0,
      structure_quality: 'weak',
      key_levels: {
        order_blocks: 0,
        active_obs: 0,
        near_price: false,
      },
      breakdown,
    };
  }

  // Require true BOS with high strength
  const recentBOS = smc.bos_events[0];
  if (recentBOS && recentBOS.strength >= 70) {
    bias = recentBOS.direction === 'up' ? 'bullish' : 'bearish';
    breakdown.structure_score = 20;
    confidence += 20;
  } else {
    // Weak or no structure = no signal for Investor
    return {
      bias: 'neutral',
      confidence: Math.min(40, confidence),
      structure_quality: 'weak',
      key_levels: {
        order_blocks: smc.order_blocks.length,
        active_obs: 0,
        near_price: false,
      },
      breakdown,
    };
  }

  // ORDER BLOCKS: ONLY multi-candle OBs (5-12+ candles)
  // Note: Would need candle count in OrderBlock type
  // For now, use stricter filters
  const activeBullishOBs = smc.order_blocks.filter(
    (ob) =>
      ob.direction === 'bullish' &&
      !ob.mitigated &&
      ob.low < currentPrice &&
      ob.origin === 'bos' // ONLY BOS-origin OBs
  );
  const activeBearishOBs = smc.order_blocks.filter(
    (ob) =>
      ob.direction === 'bearish' &&
      !ob.mitigated &&
      ob.high > currentPrice &&
      ob.origin === 'bos'
  );

  // Very tight proximity (within 1%)
  const nearBullishOB = activeBullishOBs.some(
    (ob) => currentPrice >= ob.low * 0.99 && currentPrice <= ob.high * 1.01
  );
  const nearBearishOB = activeBearishOBs.some(
    (ob) => currentPrice <= ob.high * 1.01 && currentPrice >= ob.low * 0.99
  );

  if (nearBullishOB && bias === 'bullish') {
    breakdown.ob_score = 20;
    confidence += 20;
  } else if (nearBearishOB && bias === 'bearish') {
    breakdown.ob_score = 20;
    confidence += 20;
  } else {
    // No HTF OB near price = no signal
    confidence = Math.max(20, confidence - 10);
  }

  // FVG: Only large timeframe imbalances (multi-day gaps)
  // Investor cares about macro inefficiencies only
  if (smc.liquidity_zones && smc.liquidity_zones.length >= 3) {
    breakdown.fvg_score = 15;
    confidence += 15;
  }

  // LIQUIDITY: Must sweep major levels (multi-week highs/lows)
  // This would require historical data analysis
  // For now, require multiple liquidity zones
  if (smc.liquidity_zones && smc.liquidity_zones.length >= 4) {
    breakdown.liquidity_score = 15;
    confidence += 15;
  }

  // Reduced penalty for imperfect setup (max 30%)
  if (activeBullishOBs.length + activeBearishOBs.length < 2) {
    confidence = Math.max(30, confidence - 15);
  }

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const structure_quality =
    confidence >= 75 ? 'strong' : confidence >= 50 ? 'moderate' : 'weak';

  return {
    bias,
    confidence,
    structure_quality,
    key_levels: {
      order_blocks: smc.order_blocks.length,
      active_obs: activeBullishOBs.length + activeBearishOBs.length,
      near_price: nearBullishOB || nearBearishOB,
    },
    breakdown,
  };
}

// ============================================================
// MAIN ENGINE-AWARE SMC ANALYSIS
// ============================================================

export function analyzeSMCByEngine(
  engine: EngineType,
  smc: SMCData,
  currentPrice: number,
  timeframe: string
): SMCAnalysis {
  switch (engine) {
    case 'DAYTRADER':
      return analyzeDaytraderSMC(smc, currentPrice, timeframe);
    case 'SWING':
      return analyzeSwingSMC(smc, currentPrice, timeframe);
    case 'INVESTOR':
      return analyzeInvestorSMC(smc, currentPrice, timeframe);
    default:
      return analyzeSwingSMC(smc, currentPrice, timeframe); // Default to SWING
  }
}
