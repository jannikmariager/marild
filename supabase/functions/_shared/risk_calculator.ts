/**
 * Engine-Specific Risk Calculator
 * 
 * Calculates correction risk scores using different formulas per engine:
 * - Daytrader: High volatility tolerance, accepts higher risk (0-80+)
 * - Swing: Moderate risk tolerance (0-70)
 * - Investor: Low risk tolerance, rejects signals above 50 risk
 */

import { VolumeMetrics, SMCData } from './signal_types.ts';
import { SMCAnalysis, EngineType } from './smc_analyzer.ts';

export interface RiskAnalysis {
  risk_score: number; // 0-100
  risk_level: 'low' | 'medium' | 'high' | 'extreme';
  should_reject: boolean; // true if risk exceeds engine tolerance
  breakdown: {
    volatility_risk: number;
    volume_risk: number;
    structure_risk: number;
    momentum_risk: number;
  };
}

// ============================================================
// DAYTRADER ENGINE RISK
// ============================================================

export function calculateDaytraderRisk(
  volumeMetrics: VolumeMetrics,
  smcAnalysis: SMCAnalysis,
  currentPrice: number,
  dayHigh?: number,
  dayLow?: number
): RiskAnalysis {
  const breakdown = {
    volatility_risk: 0,
    volume_risk: 0,
    structure_risk: 0,
    momentum_risk: 0,
  };

  // VOLATILITY (40% weight) - Higher volatility ALLOWED
  if (dayHigh && dayLow && currentPrice) {
    const dayRange = ((dayHigh - dayLow) / dayLow) * 100;
    if (dayRange > 5) {
      breakdown.volatility_risk = 20; // 5%+ intraday range is normal for daytrader
    } else if (dayRange > 3) {
      breakdown.volatility_risk = 15;
    } else if (dayRange > 2) {
      breakdown.volatility_risk = 10;
    } else {
      breakdown.volatility_risk = 5; // Too quiet
    }
  } else {
    breakdown.volatility_risk = 30; // Unknown volatility = risky
  }

  // VOLUME (20% weight) - Low volume is risky
  if (volumeMetrics.relative_volume < 0.5) {
    breakdown.volume_risk = 20; // Very low volume
  } else if (volumeMetrics.relative_volume < 0.8) {
    breakdown.volume_risk = 12;
  } else if (volumeMetrics.relative_volume < 1.0) {
    breakdown.volume_risk = 5;
  } else {
    breakdown.volume_risk = 0; // Good volume
  }

  // SMC_NOISE (20% weight) - Unclear structure adds risk
  if (smcAnalysis.structure_quality === 'weak') {
    breakdown.structure_risk = 20;
  } else if (smcAnalysis.structure_quality === 'moderate') {
    breakdown.structure_risk = 10;
  } else {
    breakdown.structure_risk = 0; // Strong structure = low risk
  }

  // MOMENTUM_REVERSAL (20% weight) - Against trend is risky
  if (
    volumeMetrics.order_flow_bias !== 'neutral' &&
    smcAnalysis.bias !== 'neutral'
  ) {
    const flowBullish = volumeMetrics.order_flow_bias === 'bullish';
    const smcBullish = smcAnalysis.bias === 'bullish';
    if (flowBullish !== smcBullish) {
      breakdown.momentum_risk = 20; // Conflicting signals
    } else {
      breakdown.momentum_risk = 0; // Aligned
    }
  } else {
    breakdown.momentum_risk = 10; // Neutral/unclear
  }

  // Calculate total: volatility(0.4) + volume(0.2) + smc_noise(0.2) + momentum(0.2)
  // Apply 0.6 multiplier to reduce overall risk scores
  const risk_score = Math.round(
    (breakdown.volatility_risk * 0.4 +
      breakdown.volume_risk * 0.2 +
      breakdown.structure_risk * 0.2 +
      breakdown.momentum_risk * 0.2) * 0.6
  );

  // Risk bands for DAYTRADER
  let risk_level: 'low' | 'medium' | 'high' | 'extreme';
  if (risk_score <= 40) {
    risk_level = 'low';
  } else if (risk_score <= 65) {
    risk_level = 'high';
  } else {
    risk_level = 'extreme';
  }

  // Daytrader accepts high risk (only rejects extreme >80)
  const should_reject = risk_score > 80;

  return {
    risk_score,
    risk_level,
    should_reject,
    breakdown,
  };
}

// ============================================================
// SWING ENGINE RISK
// ============================================================

export function calculateSwingRisk(
  volumeMetrics: VolumeMetrics,
  smcAnalysis: SMCAnalysis,
  currentPrice: number,
  week52High?: number,
  week52Low?: number
): RiskAnalysis {
  const breakdown = {
    volatility_risk: 0,
    volume_risk: 0,
    structure_risk: 0,
    momentum_risk: 0,
  };

  // VOLATILITY (30% weight)
  if (week52High && week52Low && currentPrice) {
    const range52w = ((week52High - week52Low) / week52Low) * 100;
    if (range52w > 100) {
      breakdown.volatility_risk = 30; // Very volatile stock
    } else if (range52w > 50) {
      breakdown.volatility_risk = 20;
    } else if (range52w > 30) {
      breakdown.volatility_risk = 10;
    } else {
      breakdown.volatility_risk = 5; // Stable
    }
  } else {
    breakdown.volatility_risk = 20;
  }

  // MISALIGNMENT (30% weight) - SMC vs volume conflict
  if (
    volumeMetrics.order_flow_bias !== 'neutral' &&
    smcAnalysis.bias !== 'neutral'
  ) {
    const flowBullish = volumeMetrics.order_flow_bias === 'bullish';
    const smcBullish = smcAnalysis.bias === 'bullish';
    if (flowBullish !== smcBullish) {
      breakdown.momentum_risk = 30; // Major misalignment
    } else {
      breakdown.momentum_risk = 5; // Aligned
    }
  } else {
    breakdown.momentum_risk = 15; // One or both neutral
  }

  // VOLUME_WEAKNESS (20% weight)
  if (volumeMetrics.relative_volume < 0.7) {
    breakdown.volume_risk = 20;
  } else if (volumeMetrics.relative_volume < 0.9) {
    breakdown.volume_risk = 12;
  } else if (volumeMetrics.relative_volume >= 1.3) {
    breakdown.volume_risk = 0; // Strong volume
  } else {
    breakdown.volume_risk = 5; // Normal
  }

  // SMC_UNCERTAINTY (20% weight)
  if (smcAnalysis.structure_quality === 'weak') {
    breakdown.structure_risk = 20;
  } else if (smcAnalysis.structure_quality === 'moderate') {
    breakdown.structure_risk = 10;
  } else {
    breakdown.structure_risk = 0;
  }

  // Calculate total: volatility(0.3) + misalignment(0.3) + volume(0.2) + smc(0.2)
  // Apply 0.6 multiplier to reduce overall risk scores
  const risk_score = Math.round(
    (breakdown.volatility_risk * 0.3 +
      breakdown.momentum_risk * 0.3 +
      breakdown.volume_risk * 0.2 +
      breakdown.structure_risk * 0.2) * 0.6
  );

  // Risk bands for SWING
  let risk_level: 'low' | 'medium' | 'high' | 'extreme';
  if (risk_score <= 40) {
    risk_level = 'low';
  } else if (risk_score <= 60) {
    risk_level = 'medium';
  } else {
    risk_level = 'high';
  }

  // Swing rejects high risk (>70)
  const should_reject = risk_score > 70;

  return {
    risk_score,
    risk_level,
    should_reject,
    breakdown,
  };
}

// ============================================================
// INVESTOR ENGINE RISK
// ============================================================

export function calculateInvestorRisk(
  volumeMetrics: VolumeMetrics,
  smcAnalysis: SMCAnalysis,
  fundamentals?: {
    pe_ratio?: number;
    profit_margin?: number;
    return_on_equity?: number;
  },
  currentPrice?: number,
  week52High?: number
): RiskAnalysis {
  const breakdown = {
    volatility_risk: 0,
    volume_risk: 0,
    structure_risk: 0,
    momentum_risk: 0, // Used for fundamental_weakness
  };

  // MACRO_UNCERTAINTY (40% weight)
  // For now, use volatility as proxy
  // TODO: Add macro indicators (VIX, treasury yields, etc.)
  if (week52High && currentPrice) {
    const pullbackFromHigh = ((week52High - currentPrice) / week52High) * 100;
    if (pullbackFromHigh > 50) {
      breakdown.volatility_risk = 40; // Deep drawdown = high macro risk
    } else if (pullbackFromHigh > 30) {
      breakdown.volatility_risk = 28;
    } else if (pullbackFromHigh > 20) {
      breakdown.volatility_risk = 16;
    } else {
      breakdown.volatility_risk = 8; // Near highs
    }
  } else {
    breakdown.volatility_risk = 30;
  }

  // FUNDAMENTAL_WEAKNESS (30% weight)
  if (fundamentals) {
    let fundamental_score = 0;

    // Check PE ratio (avoid extreme valuations)
    if (fundamentals.pe_ratio) {
      if (fundamentals.pe_ratio < 0) {
        fundamental_score += 15; // Negative earnings
      } else if (fundamentals.pe_ratio > 50) {
        fundamental_score += 10; // Overvalued
      } else if (fundamentals.pe_ratio < 10) {
        fundamental_score += 5; // Maybe value trap
      } else {
        fundamental_score += 0; // Reasonable valuation
      }
    } else {
      fundamental_score += 10; // No PE data
    }

    // Check profitability
    if (
      fundamentals.profit_margin !== undefined &&
      fundamentals.profit_margin < 5
    ) {
      fundamental_score += 10; // Low margins
    }

    // Check ROE
    if (
      fundamentals.return_on_equity !== undefined &&
      fundamentals.return_on_equity < 10
    ) {
      fundamental_score += 5; // Poor returns
    }

    breakdown.momentum_risk = Math.min(30, fundamental_score);
  } else {
    breakdown.momentum_risk = 20; // No fundamental data = risky
  }

  // VOLATILITY (30% weight)
  // Investor hates volatility
  if (volumeMetrics.volume_trend === 'decreasing') {
    breakdown.volume_risk = 5; // Stable
  } else if (volumeMetrics.volume_spike) {
    breakdown.volume_risk = 20; // Unusual activity = risky
  } else {
    breakdown.volume_risk = 10; // Normal
  }

  // SMC QUALITY
  if (smcAnalysis.structure_quality !== 'strong') {
    breakdown.structure_risk = 15; // Investor needs perfect structure
  } else {
    breakdown.structure_risk = 0;
  }

  // Calculate total: macro(0.4) + fundamentals(0.3) + volatility(0.3)
  // Apply 0.6 multiplier to reduce overall risk scores
  const risk_score = Math.round(
    (breakdown.volatility_risk * 0.4 +
      breakdown.momentum_risk * 0.3 +
      breakdown.volume_risk * 0.3) * 0.6
  );

  // Risk bands for INVESTOR
  let risk_level: 'low' | 'medium' | 'high' | 'extreme';
  if (risk_score <= 30) {
    risk_level = 'low';
  } else if (risk_score <= 50) {
    risk_level = 'medium';
  } else {
    risk_level = 'high';
  }

  // Investor REJECTS signals above 50 risk
  const should_reject = risk_score > 50;

  return {
    risk_score,
    risk_level,
    should_reject,
    breakdown,
  };
}

// ============================================================
// MAIN ENGINE-AWARE RISK CALCULATOR
// ============================================================

export function calculateRiskByEngine(
  engine: EngineType,
  volumeMetrics: VolumeMetrics,
  smcAnalysis: SMCAnalysis,
  quoteData: {
    current_price: number;
    day_high?: number;
    day_low?: number;
    week_52_high?: number;
    week_52_low?: number;
  },
  fundamentals?: {
    pe_ratio?: number;
    profit_margin?: number;
    return_on_equity?: number;
  }
): RiskAnalysis {
  switch (engine) {
    case 'DAYTRADER':
      return calculateDaytraderRisk(
        volumeMetrics,
        smcAnalysis,
        quoteData.current_price,
        quoteData.day_high,
        quoteData.day_low
      );
    case 'SWING':
      return calculateSwingRisk(
        volumeMetrics,
        smcAnalysis,
        quoteData.current_price,
        quoteData.week_52_high,
        quoteData.week_52_low
      );
    case 'INVESTOR':
      return calculateInvestorRisk(
        volumeMetrics,
        smcAnalysis,
        fundamentals,
        quoteData.current_price,
        quoteData.week_52_high
      );
    default:
      return calculateSwingRisk(
        volumeMetrics,
        smcAnalysis,
        quoteData.current_price,
        quoteData.week_52_high,
        quoteData.week_52_low
      );
  }
}
