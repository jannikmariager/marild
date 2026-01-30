/**
 * OVERNIGHT HYGIENE RULE - V2_ROBUST ONLY
 * 
 * Deterministic, R-based capital hygiene rules for swing positions.
 * Reduces multi-day stagnant trades without killing trend runners.
 * 
 * APPLIES ONLY TO: SWING_V2_ROBUST in SHADOW mode
 * 
 * Rules:
 * 1. Partial profit lock (50% close) when ≥50% of TP1 reached
 * 2. Risk removal: SL to breakeven on remainder
 * 3. ATR-based tight trailing stop on runner portion
 */

// @ts-nocheck
import { calculateATR } from "../_shared/price_levels_calculator.ts";
import { fetchPositionBars } from '../_shared/yahoo_v8_client.ts';

export interface OvernightHygieneContext {
  engineVersion: string;
  runMode: 'PRIMARY' | 'SHADOW';
  nowUtc: Date;
}

export interface OvernightHygieneResult {
  triggered: boolean;
  action?: 'PARTIAL_CLOSE' | 'MOVE_SL_BE' | 'ACTIVATE_ATR_TSL';
  partialClosePct?: number;
  partialClosePrice?: number;
  newStopLoss?: number;
  newTrailingStopPrice?: number;
  atrValue?: number;
  metadata?: {
    unrealized_R?: number;
    TP1_R?: number;
    continuation_score?: number;
    time_in_position_minutes?: number;
  };
}

interface TrailingStopConfig {
  enabled: boolean;
  k_factor: number;  // multiplier for ATR (default 1.0)
}

const V2_OVERNIGHT_CONFIG: TrailingStopConfig = {
  enabled: true,
  k_factor: 1.0,
};

/**
 * Determine if current UTC time is in pre-close window.
 * Pre-close = 20:45–21:00 UTC (last 15 minutes before 4pm ET close)
 */
export function isInPreCloseWindow(nowUtc: Date): boolean {
  const hour = nowUtc.getUTCHours();
  const minutes = nowUtc.getUTCMinutes();
  
  // Window: 20:45–21:00 UTC (4:45 PM – 5:00 PM ET)
  return hour === 20 && minutes >= 45;
}

/**
 * Calculate TP1 in R multiples from entry and TP1 prices.
 * Returns the R value for TP1 (e.g., 1.5 means TP1 is 1.5R away from entry).
 */
function calculateTP1RMultiple(
  entryPrice: number,
  tp1Price: number,
  riskPerShare: number  // |entry - SL|
): number {
  const rewardPerShare = Math.abs(tp1Price - entryPrice);
  if (riskPerShare <= 0) return 0;
  return rewardPerShare / riskPerShare;
}

/**
 * Check if position is eligible for overnight hygiene intervention.
 * 
 * Eligibility (ALL must be true):
 * 1. Progress toward TP1 ≥ 50%
 * 2. Trade age ≥ 1 full session (~400+ minutes)
 * 3. Weak continuation (simplified: last 5 bars show no new extreme)
 */
export async function checkOvernightHygieneEligibility(
  position: any,
  currentPrice: number
): Promise<{
  eligible: boolean;
  reason?: string;
  metadata?: {
    unrealized_R?: number;
    TP1_R?: number;
    continuationScore?: number;
    timeInPositionMinutes?: number;
  };
}> {
  const isLong = position.side === 'LONG';
  const entryPrice = position.entry_price;
  const stopLoss = position.stop_loss;
  const tp1Price = position.take_profit;
  const openedAt = new Date(position.opened_at);
  const nowUtc = new Date();
  
  // 1. Calculate R-based progress
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  if (riskPerShare <= 0) {
    return { eligible: false, reason: 'invalid_risk' };
  }
  
  const priceDiff = isLong
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  
  const unrealizedR = riskPerShare > 0 ? priceDiff / riskPerShare : 0;
  const tp1RMultiple = calculateTP1RMultiple(entryPrice, tp1Price, riskPerShare);
  
  // Condition 1: Progress toward TP1 ≥ 50%
  const progressThreshold = 0.5 * tp1RMultiple;
  if (unrealizedR < progressThreshold) {
    return {
      eligible: false,
      reason: 'insufficient_progress',
      metadata: {
        unrealized_R: unrealizedR,
        TP1_R: tp1RMultiple,
      },
    };
  }
  
  // Condition 2: Trade age ≥ 1 full session
  const timeInPositionMs = nowUtc.getTime() - openedAt.getTime();
  const timeInPositionMinutes = timeInPositionMs / (1000 * 60);
  const MIN_SESSION_MINUTES = 360; // ~6 hours (conservative for one session)
  
  if (timeInPositionMinutes < MIN_SESSION_MINUTES) {
    return {
      eligible: false,
      reason: 'trade_too_young',
      metadata: {
        unrealized_R: unrealizedR,
        TP1_R: tp1RMultiple,
        timeInPositionMinutes,
      },
    };
  }
  
  // Condition 3: Weak continuation (simplified check)
  // Fetch recent bars to detect if there's a new favorable extreme
  let continuationScore = 0.5; // Default neutral
  
  try {
    const bars = await fetchPositionBars(position.ticker, 5, '1d');
    if (bars && bars.length >= 2) {
      const recentBar = bars[bars.length - 1];
      const prevBar = bars[bars.length - 2];
      
      if (isLong) {
        // For LONG: check if recent bar made a new high
        if (recentBar.high > prevBar.high) {
          continuationScore = 0.8; // Strong continuation
        } else if (recentBar.low > prevBar.low) {
          continuationScore = 0.6; // Moderate continuation
        } else {
          continuationScore = 0.2; // Weak continuation
        }
      } else {
        // For SHORT: check if recent bar made a new low
        if (recentBar.low < prevBar.low) {
          continuationScore = 0.8; // Strong continuation
        } else if (recentBar.high < prevBar.high) {
          continuationScore = 0.6; // Moderate continuation
        } else {
          continuationScore = 0.2; // Weak continuation
        }
      }
    }
  } catch (e) {
    // If bar fetch fails, log and use default neutral score
    console.warn(`[overnight_hygiene] Failed to fetch bars for ${position.ticker}: ${e?.message}`);
  }
  
  // Condition 3: continuation_score < 0.4
  if (continuationScore >= 0.4) {
    return {
      eligible: false,
      reason: 'strong_continuation',
      metadata: {
        unrealized_R: unrealizedR,
        TP1_R: tp1RMultiple,
        continuationScore,
        timeInPositionMinutes,
      },
    };
  }
  
  // All conditions met
  return {
    eligible: true,
    metadata: {
      unrealized_R: unrealizedR,
      TP1_R: tp1RMultiple,
      continuationScore,
      timeInPositionMinutes,
    },
  };
}

/**
 * Compute ATR-based trailing stop price for runner portion.
 * 
 * Formula:
 * - For LONG: trailing_stop = highest_favorable_price - (k * ATR)
 * - For SHORT: trailing_stop = lowest_favorable_price + (k * ATR)
 * 
 * Where k = 1.0 (configurable)
 */
async function computeATRBasedTrailingStop(
  position: any,
  currentPrice: number
): Promise<{
  atrValue: number;
  trailingStopPrice: number;
}> {
  try {
    // Fetch intraday bars for short-term ATR (e.g., ATR(5) or ATR(10))
    const bars = await fetchPositionBars(position.ticker, 10, '1h');
    
    if (!bars || bars.length < 6) {
      // Fallback: use entry distance as proxy
      const defaultATR = Math.abs(position.entry_price - position.stop_loss);
      const isLong = position.side === 'LONG';
      const trailingStopPrice = isLong
        ? currentPrice - V2_OVERNIGHT_CONFIG.k_factor * defaultATR
        : currentPrice + V2_OVERNIGHT_CONFIG.k_factor * defaultATR;
      
      return {
        atrValue: defaultATR,
        trailingStopPrice,
      };
    }
    
    // Calculate short-term ATR
    const atr = calculateATR(bars, 5);
    
    const isLong = position.side === 'LONG';
    const trailingStopPrice = isLong
      ? currentPrice - V2_OVERNIGHT_CONFIG.k_factor * atr
      : currentPrice + V2_OVERNIGHT_CONFIG.k_factor * atr;
    
    return {
      atrValue: atr,
      trailingStopPrice,
    };
  } catch (e) {
    console.warn(`[overnight_hygiene] Failed to compute ATR for ${position.ticker}: ${e?.message}`);
    
    // Fallback to simple percentage-based trail
    const defaultATR = Math.abs(position.entry_price - position.stop_loss);
    const isLong = position.side === 'LONG';
    const trailingStopPrice = isLong
      ? currentPrice - V2_OVERNIGHT_CONFIG.k_factor * defaultATR
      : currentPrice + V2_OVERNIGHT_CONFIG.k_factor * defaultATR;
    
    return {
      atrValue: defaultATR,
      trailingStopPrice,
    };
  }
}

/**
 * Apply overnight hygiene rule to an eligible position.
 * 
 * Steps:
 * 1. Close 50% at market
 * 2. Move SL to breakeven on remainder
 * 3. Activate tight ATR-based trailing stop on runner
 * 
 * Returns array of actions to execute.
 */
export async function applyOvernightHygiene(
  position: any,
  currentPrice: number,
  ctx: OvernightHygieneContext
): Promise<OvernightHygieneResult[]> {
  const results: OvernightHygieneResult[] = [];
  
  // Verify context is V2_ROBUST in SHADOW mode
  if (ctx.engineVersion !== 'SWING_V2_ROBUST' || ctx.runMode !== 'SHADOW') {
    console.warn('[overnight_hygiene] Rule only applies to SWING_V2_ROBUST in SHADOW mode');
    return [];
  }
  
  // Check eligibility
  const eligibility = await checkOvernightHygieneEligibility(position, currentPrice);
  if (!eligibility.eligible) {
    return [];
  }
  
  console.log(
    `[overnight_hygiene] ✅ ${position.ticker} eligible for overnight hygiene (unreal R=${eligibility.metadata?.unrealized_R?.toFixed(2)})`
  );
  
  // STEP 1: Partial profit close (50%)
  results.push({
    triggered: true,
    action: 'PARTIAL_CLOSE',
    partialClosePct: 0.5,
    partialClosePrice: currentPrice,
    metadata: eligibility.metadata,
  });
  
  // STEP 2: Risk removal (move SL to breakeven)
  results.push({
    triggered: true,
    action: 'MOVE_SL_BE',
    newStopLoss: position.entry_price, // Breakeven
    metadata: eligibility.metadata,
  });
  
  // STEP 3: Activate tight ATR-based trailing stop
  const atrTrail = await computeATRBasedTrailingStop(position, currentPrice);
  results.push({
    triggered: true,
    action: 'ACTIVATE_ATR_TSL',
    newTrailingStopPrice: atrTrail.trailingStopPrice,
    atrValue: atrTrail.atrValue,
    metadata: eligibility.metadata,
  });
  
  return results;
}

/**
 * Evaluate if overnight hygiene should fire for a given position.
 * Main entry point called from position exit logic.
 */
export async function evaluateOvernightHygiene(
  position: any,
  currentPrice: number,
  ctx: OvernightHygieneContext
): Promise<OvernightHygieneResult[]> {
  // Early exit: only apply in pre-close window
  if (!isInPreCloseWindow(ctx.nowUtc)) {
    return [];
  }
  
  // Early exit: only V2_ROBUST in SHADOW
  if (ctx.engineVersion !== 'SWING_V2_ROBUST' || ctx.runMode !== 'SHADOW') {
    return [];
  }
  
  // Check eligibility and apply if qualified
  const eligibility = await checkOvernightHygieneEligibility(position, currentPrice);
  if (!eligibility.eligible) {
    return [];
  }
  
  // Apply hygiene rule
  return await applyOvernightHygiene(position, currentPrice, ctx);
}
