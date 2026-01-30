/**
 * Signal Scorer - Phase 2 Step 4
 * 
 * Centralizes rule-based signal scoring logic.
 * Computes confidence scores from SMC, volume, and sentiment analysis.
 * Generates preliminary signals before AI evaluation.
 */

import {
  RawSignalInput,
  SMCData,
  VolumeMetrics,
} from "./signal_types.ts";
import { analyzeSMCByEngine, SMCAnalysis, EngineType } from "./smc_analyzer.ts";
import { calculateRiskByEngine, RiskAnalysis } from "./risk_calculator.ts";

// ============================================================
// TYPES
// ============================================================

export interface RuleSignal {
  symbol: string;
  timeframe: string;
  raw_signal_type: "buy" | "sell" | "neutral";
  raw_confidence: number; // 0-100
  confidence_smc: number; // 0-100 (renamed for consistency)
  confidence_volume: number; // 0-100
  confidence_sentiment: number; // 0-100
  confidence_momentum?: number; // 0-100 (for engines that use it)
  confidence_fundamentals?: number; // 0-100 (for INVESTOR)
  confluence_score: number; // 0-100
  correction_risk: number; // 0-100
  risk_should_reject: boolean; // true if risk exceeds engine tolerance
  smc_analysis: SMCAnalysis;
  risk_analysis: RiskAnalysis;
}

// ============================================================
// COMPUTE RULE-BASED SIGNAL
// ============================================================

/**
 * Compute rule-based signal from raw market data
 * 
 * This is the deterministic scoring layer that runs before AI evaluation.
 * It analyzes SMC structure, volume patterns, and sentiment to generate
 * a preliminary signal with confidence scores.
 * 
 * @param raw - Raw signal input data
 * @param engineType - Trading engine type (DAYTRADER, SWING, INVESTOR)
 */
export function computeRuleSignal(raw: RawSignalInput, engineType: EngineType = 'SWING'): RuleSignal {
  console.log(`[computeRuleSignal] ⭐ ENTRY: Computing for ${raw.symbol} ${raw.timeframe} [${engineType}]`);
  const startMs = Date.now();

  try {
    // Step 1: Engine-specific SMC analysis
    console.log(`[computeRuleSignal] Step 1/8 - Analyzing SMC (${raw.smc.order_blocks.length} OBs, ${raw.smc.bos_events.length} BOS)`);
    const smc_analysis = analyzeSMCByEngine(
      engineType,
      raw.smc,
      raw.quote.current_price,
      raw.timeframe
    );
    console.log(`[computeRuleSignal] Step 1 ✓ SMC analysis: ${smc_analysis.bias} @ ${smc_analysis.confidence}%`);

    // Step 2: Compute volume confidence
    console.log(`[computeRuleSignal] Step 2/8 - Computing volume score`);
    const volume_conf = computeVolumeScore(raw.volume_metrics);
    console.log(`[computeRuleSignal] Step 2 ✓ Volume: ${volume_conf.toFixed(0)}%`);

    // Step 3: Compute sentiment confidence
    console.log(`[computeRuleSignal] Step 3/8 - Computing sentiment score`);
    const sentiment_conf = computeSentimentScore(raw.sentiment_score);
    console.log(`[computeRuleSignal] Step 3 ✓ Sentiment: ${sentiment_conf.toFixed(0)}%`);

    // Step 4: Compute momentum/trend confidence (for applicable engines)
    console.log(`[computeRuleSignal] Step 4/8 - Computing momentum score`);
    const momentum_conf = computeMomentumScore(raw.volume_metrics, smc_analysis);
    console.log(`[computeRuleSignal] Step 4 ✓ Momentum: ${momentum_conf.toFixed(0)}%`);

    // Step 5: Compute fundamentals confidence (for INVESTOR engine)
    console.log(`[computeRuleSignal] Step 5/8 - Computing fundamentals${engineType === 'INVESTOR' ? '' : ' (skipped - not INVESTOR)'}`);
    const fundamentals_conf = engineType === 'INVESTOR' && raw.fundamentals
      ? computeFundamentalsScore(raw.fundamentals)
      : undefined;
    if (fundamentals_conf) console.log(`[computeRuleSignal] Step 5 ✓ Fundamentals: ${fundamentals_conf.toFixed(0)}%`);

    // Step 6: Calculate NEW alignment-based confluence score
    console.log(`[computeRuleSignal] Step 6/8 - Computing alignment confluence`);
    const confluence = computeAlignmentConfluence(
      smc_analysis.confidence,
      volume_conf,
      sentiment_conf,
      momentum_conf,
      fundamentals_conf
    );
    console.log(`[computeRuleSignal] Step 6 ✓ Confluence: ${confluence.toFixed(0)}%`);

    // Step 7: Calculate engine-specific risk
    console.log(`[computeRuleSignal] Step 7/8 - Computing engine-specific risk`);
    const risk_analysis = calculateRiskByEngine(
      engineType,
      raw.volume_metrics,
      smc_analysis,
      {
        current_price: raw.quote.current_price,
        day_high: raw.quote.day_high,
        day_low: raw.quote.day_low,
        week_52_high: raw.quote.week_52_high,
        week_52_low: raw.quote.week_52_low,
      },
      raw.fundamentals
    );
    console.log(`[computeRuleSignal] Step 7 ✓ Risk: ${risk_analysis.risk_score.toFixed(0)}%, rejection: ${risk_analysis.should_reject}`);

    // Step 8: Determine signal type and calculate confidence with NEW formula
    console.log(`[computeRuleSignal] Step 8/8 - Determining signal type`);
    const { signal_type, confidence } = determineSignal(
      smc_analysis.bias,
      raw.sentiment_score,
      confluence,
      smc_analysis.confidence,
      {
        smc: smc_analysis.confidence,
        volume: volume_conf,
        sentiment: sentiment_conf,
        fundamentals: fundamentals_conf || 50,
        risk: risk_analysis.risk_score,
      }
    );
    console.log(`[computeRuleSignal] Step 8 ✓ Signal: ${signal_type} @ ${confidence.toFixed(0)}%`);

    const ruleSignal: RuleSignal = {
      symbol: raw.symbol,
      timeframe: raw.timeframe,
      raw_signal_type: signal_type,
      raw_confidence: confidence,
      confidence_smc: smc_analysis.confidence,
      confidence_volume: volume_conf,
      confidence_sentiment: sentiment_conf,
      confidence_momentum: momentum_conf,
      confidence_fundamentals: fundamentals_conf,
      confluence_score: confluence,
      correction_risk: risk_analysis.risk_score,
      risk_should_reject: risk_analysis.should_reject,
      smc_analysis,
      risk_analysis,
    };

    const totalMs = Date.now() - startMs;
    console.log(
      `[computeRuleSignal] ✓ COMPLETE in ${totalMs}ms: ${raw.symbol} [${engineType}]: ${signal_type} @ ${confidence}% (confluence: ${confluence}%, risk: ${risk_analysis.risk_score}%) ${risk_analysis.should_reject ? '❌ REJECTED' : '✓'}`
    );

    return ruleSignal;
  } catch (err) {
    const totalMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[computeRuleSignal] ❌ FAILED after ${totalMs}ms for ${raw.symbol}: ${errMsg}`);
    if (err instanceof Error) console.error('  Stack:', err.stack);
    throw err;
  }
}

// ============================================================
// SMC SCORING
// ============================================================

interface SMCScore {
  smc_bias: "bullish" | "bearish" | "neutral";
  smc_conf: number;
}

function computeSMCScore(smc: SMCData, currentPrice: number): SMCScore {
  let smc_bias: "bullish" | "bearish" | "neutral" = "neutral";
  let smc_conf = 50; // Base confidence

  // Analyze BOS events
  const recentBOS = smc.bos_events[0]; // Most recent
  let bosWeight = 0;

  if (recentBOS) {
    if (recentBOS.direction === "up") {
      smc_bias = "bullish";
      bosWeight = recentBOS.strength / 100; // Strength is 0-100
      smc_conf += 10 + bosWeight * 20; // Add 10-30 based on strength
    } else {
      smc_bias = "bearish";
      bosWeight = recentBOS.strength / 100;
      smc_conf += 10 + bosWeight * 20;
    }
  }

  // Analyze Order Blocks
  const activeBullishOBs = smc.order_blocks.filter(
    (ob) => ob.direction === "bullish" && !ob.mitigated && ob.low < currentPrice
  );
  const activeBearishOBs = smc.order_blocks.filter(
    (ob) => ob.direction === "bearish" && !ob.mitigated && ob.high > currentPrice
  );

  // Check if price is near an active OB
  const nearBullishOB = activeBullishOBs.some(
    (ob) => currentPrice >= ob.low && currentPrice <= ob.high * 1.02
  );
  const nearBearishOB = activeBearishOBs.some(
    (ob) => currentPrice <= ob.high && currentPrice >= ob.low * 0.98
  );

  // Adjust bias and confidence based on OB proximity
  if (nearBullishOB && activeBullishOBs.length > activeBearishOBs.length) {
    if (smc_bias !== "bearish") {
      smc_bias = "bullish";
      smc_conf += 15; // Strong bullish structure
    } else {
      smc_conf -= 10; // Conflicting signals
    }
  } else if (nearBearishOB && activeBearishOBs.length > activeBullishOBs.length) {
    if (smc_bias !== "bullish") {
      smc_bias = "bearish";
      smc_conf += 15; // Strong bearish structure
    } else {
      smc_conf -= 10; // Conflicting signals
    }
  }

  // Simple OB count bias (if no BOS)
  if (!recentBOS) {
    if (activeBullishOBs.length > activeBearishOBs.length + 1) {
      smc_bias = "bullish";
      smc_conf += 5;
    } else if (activeBearishOBs.length > activeBullishOBs.length + 1) {
      smc_bias = "bearish";
      smc_conf += 5;
    }
  }

  // Penalty for unclear structure
  if (smc.order_blocks.length === 0 && !recentBOS) {
    smc_conf -= 20; // No SMC data available
  }

  // Clamp confidence to 0-100
  smc_conf = Math.max(0, Math.min(100, Math.round(smc_conf)));

  return { smc_bias, smc_conf };
}

// ============================================================
// VOLUME SCORING
// ============================================================

function computeVolumeScore(volume: VolumeMetrics): number {
  let score = 50; // Base

  // Relative volume scoring (relaxed threshold: 0.7 instead of 1.0)
  // Score = min(100, (relative_volume / 0.7) * 100)
  const normalizedVolume = (volume.relative_volume / 0.7) * 100;
  score = Math.min(100, normalizedVolume);
  
  // Apply bands for discrete scoring
  if (volume.relative_volume >= 1.2) {
    score = 85; // Very high volume
  } else if (volume.relative_volume >= 1.0) {
    score = 75;
  } else if (volume.relative_volume >= 0.85) {
    score = 65;
  } else if (volume.relative_volume >= 0.7) {
    score = 55;
  } else if (volume.relative_volume >= 0.6) {
    score = 45;
  } else {
    score = 35; // Low volume
  }

  // Volume trend adjustment
  if (volume.volume_trend === "increasing") {
    score += 10;
  } else if (volume.volume_trend === "decreasing") {
    score -= 10;
  }

  // Volume spike bonus
  if (volume.volume_spike) {
    score += 10;
  }

  // Order flow bias alignment
  if (volume.order_flow_bias === "bullish" || volume.order_flow_bias === "bearish") {
    score += 5; // Clear directional bias
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============================================================
// SENTIMENT SCORING
// ============================================================

function computeSentimentScore(sentimentScore: number): number {
  let confidence = 50; // Base

  // Map sentiment score (-100 to +100) to confidence (20-85)
  const absSentiment = Math.abs(sentimentScore);

  if (absSentiment >= 40) {
    // Strong sentiment (bullish or bearish)
    confidence = 70 + (absSentiment - 40) * 0.25; // 70-85
  } else if (absSentiment >= 20) {
    // Moderate sentiment
    confidence = 55 + (absSentiment - 20) * 0.75; // 55-70
  } else if (absSentiment >= 10) {
    // Mild sentiment
    confidence = 50 + (absSentiment - 10) * 0.5; // 50-55
  } else {
    // Neutral/weak sentiment
    confidence = 40 + absSentiment * 1.0; // 40-50
  }

  // Clamp to 20-85
  return Math.max(20, Math.min(85, Math.round(confidence)));
}

// ============================================================
// MOMENTUM SCORING
// ============================================================

function computeMomentumScore(volume: VolumeMetrics, smc: SMCAnalysis): number {
  let score = 50; // Base

  // Alignment between volume flow and SMC bias
  if (volume.order_flow_bias !== 'neutral' && smc.bias !== 'neutral') {
    const flowBullish = volume.order_flow_bias === 'bullish';
    const smcBullish = smc.bias === 'bullish';
    if (flowBullish === smcBullish) {
      score = 75; // Strong alignment
    } else {
      score = 30; // Conflicting momentum
    }
  }

  // Volume trend as momentum indicator
  if (volume.volume_trend === 'increasing') {
    score += 10;
  } else if (volume.volume_trend === 'decreasing') {
    score -= 10;
  }

  // SMC structure quality
  if (smc.structure_quality === 'strong') {
    score += 15;
  } else if (smc.structure_quality === 'weak') {
    score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============================================================
// FUNDAMENTALS SCORING (INVESTOR ENGINE)
// ============================================================

function computeFundamentalsScore(fundamentals: any): number {
  // If fundamentals are missing or empty, return neutral score (no penalty)
  if (!fundamentals || Object.keys(fundamentals).length <= 1) {
    return 50; // Neutral - don't penalize for missing data
  }
  
  let score = 50; // Base

  // PE Ratio scoring (reasonable valuation)
  if (fundamentals.pe_ratio) {
    if (fundamentals.pe_ratio < 0) {
      score -= 20; // Negative earnings
    } else if (fundamentals.pe_ratio > 50) {
      score -= 15; // Overvalued
    } else if (fundamentals.pe_ratio >= 10 && fundamentals.pe_ratio <= 30) {
      score += 15; // Sweet spot
    }
  }

  // Profit margin
  if (fundamentals.profit_margin) {
    if (fundamentals.profit_margin >= 20) {
      score += 15; // Excellent margins
    } else if (fundamentals.profit_margin >= 10) {
      score += 10; // Good margins
    } else if (fundamentals.profit_margin < 5) {
      score -= 15; // Poor margins
    }
  }

  // Return on Equity
  if (fundamentals.return_on_equity) {
    if (fundamentals.return_on_equity >= 20) {
      score += 15; // Excellent ROE
    } else if (fundamentals.return_on_equity >= 15) {
      score += 10; // Good ROE
    } else if (fundamentals.return_on_equity < 10) {
      score -= 10; // Poor ROE
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============================================================
// ENGINE-SPECIFIC CONFLUENCE CALCULATION
// ============================================================

/**
 * NEW: Alignment-based confluence scoring
 * Counts how many factors are aligned (score > 60)
 * Returns higher scores for 2/3/4 factor alignment
 */
function computeAlignmentConfluence(
  smcConf: number,
  volumeConf: number,
  sentimentConf: number,
  momentumConf: number,
  fundamentalsConf?: number
): number {
  const ALIGNMENT_THRESHOLD = 60;
  const factors = [smcConf, volumeConf, sentimentConf, momentumConf];
  
  // Add fundamentals if provided (for INVESTOR engine)
  if (fundamentalsConf !== undefined) {
    factors.push(fundamentalsConf);
  }
  
  // Count aligned factors
  const alignedCount = factors.filter(score => score >= ALIGNMENT_THRESHOLD).length;
  const totalFactors = factors.length;
  
  // Scoring based on alignment
  if (alignedCount === totalFactors) {
    return 100; // All factors aligned
  } else if (alignedCount === totalFactors - 1) {
    return 85; // 3/4 or 4/5 aligned
  } else if (alignedCount === totalFactors - 2 || (alignedCount >= 2 && totalFactors >= 4)) {
    return 70; // 2/4 or 3/5 aligned
  } else if (alignedCount === 1) {
    // Scale 0-50 based on strength of the one aligned factor
    const maxAligned = Math.max(...factors);
    return Math.round((maxAligned / 100) * 50);
  } else {
    // No factors aligned
    return 25;
  }
}

/**
 * LEGACY: Engine-specific weighted confluence (kept for backward compatibility)
 * Use computeAlignmentConfluence() for new signals
 */
function computeEngineConfluence(
  engine: EngineType,
  smcConf: number,
  volumeConf: number,
  sentimentConf: number,
  momentumConf: number,
  fundamentalsConf?: number
): number {
  let confluence = 0;

  switch (engine) {
    case 'DAYTRADER':
      // SMC(20) + Volume(20) + Momentum(25) + Sentiment(15) + Volatility(20) = 100
      // Note: Volatility is handled in risk calculation, so we scale others proportionally
      confluence =
        smcConf * 0.2 +
        volumeConf * 0.2 +
        momentumConf * 0.25 +
        sentimentConf * 0.15 +
        50 * 0.2; // Base volatility score
      break;

    case 'SWING':
      // SMC(30) + Volume(20) + Momentum(20) + Sentiment(20) + TrendAlign(10) = 100
      confluence =
        smcConf * 0.3 +
        volumeConf * 0.2 +
        momentumConf * 0.2 +
        sentimentConf * 0.2 +
        50 * 0.1; // Base trend alignment
      break;

    case 'INVESTOR':
      // Fundamentals(35) + Macro(25) + LT-SMC(20) + TrendStability(15) + Volume(5) = 100
      const fundScore = fundamentalsConf || 50; // Default to neutral if not provided
      confluence =
        fundScore * 0.35 +
        50 * 0.25 + // Base macro score (would need real macro indicators)
        smcConf * 0.2 +
        momentumConf * 0.15 +
        volumeConf * 0.05;
      break;

    default:
      // Fallback to SWING
      confluence =
        smcConf * 0.3 +
        volumeConf * 0.2 +
        momentumConf * 0.2 +
        sentimentConf * 0.2 +
        50 * 0.1;
  }

  return Math.round(confluence);
}

// ============================================================
// SIGNAL TYPE DETERMINATION
// ============================================================

interface SignalDetermination {
  signal_type: "buy" | "sell" | "neutral";
  confidence: number;
}

interface ConfidenceFactors {
  smc: number;
  volume: number;
  sentiment: number;
  fundamentals: number;
  risk: number;
}

function determineSignal(
  smcBias: "bullish" | "bearish" | "neutral",
  sentimentScore: number,
  confluence: number,
  smcConf: number,
  factors?: ConfidenceFactors
): SignalDetermination {
  let signal_type: "buy" | "sell" | "neutral" = "neutral";
  
  // NEW CONFIDENCE FORMULA:
  // confidence = 0.20*smc + 0.20*volume + 0.20*sentiment + 0.25*confluence + 0.15*fundamentals - (correction_risk * 0.40)
  let confidence: number;
  
  if (factors) {
    // Apply new weighted formula
    const riskPenalty = Math.min(40, factors.risk * 0.40); // Cap risk penalty at 40%
    confidence = 
      (factors.smc * 0.20) +
      (factors.volume * 0.20) +
      (factors.sentiment * 0.20) +
      (confluence * 0.25) +
      (factors.fundamentals * 0.15) -
      riskPenalty;
    
    // Clamp to 0-100
    confidence = Math.max(0, Math.min(100, confidence));
  } else {
    // Fallback to confluence-based (legacy)
    confidence = confluence;
  }

  // Primary decision based on SMC bias
  if (smcBias === "bullish") {
    // SMC is bullish
    if (sentimentScore >= -10) {
      // Sentiment not strongly bearish
      signal_type = "buy";
    } else {
      // Sentiment conflicts (bearish)
      signal_type = "neutral";
      confidence -= 15; // Penalty for disagreement
    }
  } else if (smcBias === "bearish") {
    // SMC is bearish
    if (sentimentScore <= 10) {
      // Sentiment not strongly bullish
      signal_type = "sell";
    } else {
      // Sentiment conflicts (bullish)
      signal_type = "neutral";
      confidence -= 15; // Penalty for disagreement
    }
  } else {
    // SMC is neutral
    // Use sentiment as tiebreaker if strong enough
    if (sentimentScore >= 30 && smcConf >= 40) {
      signal_type = "buy";
      confidence -= 10; // Reduced confidence (no SMC confirmation)
    } else if (sentimentScore <= -30 && smcConf >= 40) {
      signal_type = "sell";
      confidence -= 10;
    } else {
      signal_type = "neutral";
    }
  }

  // Additional penalty if SMC confidence is low
  if (smcConf < 50 && signal_type !== "neutral") {
    confidence -= 10;
  }

  // Clamp confidence
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return { signal_type, confidence };
}
