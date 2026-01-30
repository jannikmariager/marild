// supabase/functions/_shared/backtest/engine/signal_engine.ts
// Signal engine: evaluate both long and short, apply tie-breaking

import type { OHLCV, SMCResult, TrendResult, VolumeResult, LiquidityResult, VolatilityResult, RiskLevels } from './types.ts';
import { computeConfidence } from './confluence_engine.ts';
import { generateRiskLevels } from './risk_engine.ts';

export interface DirectionCandidate {
  direction: 'long'|'short';
  confidence: number;
  risk: RiskLevels | null;
  reason: string;
}

export interface SignalDecision {
  direction: 'long'|'short'|'none';
  tp_price: number|null;
  sl_price: number|null;
  confidence: number;
  reason: string;
}

// Evaluate single direction candidate
function evaluateDirection(args: {
  dir: 'long'|'short';
  primary: OHLCV[];
  smc: SMCResult;
  trend: TrendResult;
  volume: VolumeResult;
  liquidity: LiquidityResult;
  volatility: VolatilityResult;
}): DirectionCandidate {
  const { dir, primary, smc, trend, volume, liquidity, volatility } = args;
  const entryPrice = primary[primary.length - 1]?.close;

  // Alignment checks
  let smcStrength = smc.smc_strength;
  // Direction-specific bonus: OB/BOS alignment
  const recentBos = smc.bos.slice(-3);
  const bosAligned = recentBos.some(b => (dir === 'long' && b.direction === 'up') || (dir === 'short' && b.direction === 'down'));
  if (!bosAligned) smcStrength = Math.max(0, smcStrength - 25);

  // Premium/discount rule
  if (dir === 'long' && smc.premium_discount_zone === 'premium') smcStrength = Math.max(0, smcStrength - 20);
  if (dir === 'short' && smc.premium_discount_zone === 'discount') smcStrength = Math.max(0, smcStrength - 20);

  // Trend alignment
  let trendStr = trend.strength;
  if (dir === 'long' && trend.direction !== 'up') trendStr = Math.max(0, trendStr - 30);
  if (dir === 'short' && trend.direction !== 'down') trendStr = Math.max(0, trendStr - 30);
  if (trend.exhaustion) trendStr = Math.max(0, trendStr - 20);

  // Volume alignment: expansion on impulse
  let volScore = volume.score;
  if (!volume.expansion) volScore = Math.max(0, volScore - 20);
  if (volume.divergence) volScore = Math.max(0, volScore - 15);

  // Liquidity: sweep on relevant side
  let liqScore = liquidity.score;
  if (dir === 'long' && liquidity.sweep !== 'sell_side') liqScore = Math.max(0, liqScore - 20);
  if (dir === 'short' && liquidity.sweep !== 'buy_side') liqScore = Math.max(0, liqScore - 20);

  // Volatility: penalize low (chop) or extreme high
  let volat = volatility.score;
  if (volatility.state === 'low') volat = Math.max(0, volat - 30);

  const confidence = computeConfidence({
    smc_strength: smcStrength,
    trend_strength: trendStr,
    volume_score: volScore,
    liquidity_score: liqScore,
    volatility_score: volat,
  });

  // Risk levels
  const risk = generateRiskLevels({ direction: dir, entryPrice, primary, smc, vol: volatility });

  // If risk fails RR check, confidence drops to 0
  if (!risk) {
    return { direction: dir, confidence: 0, risk: null, reason: 'RR invalid' };
  }

  return { direction: dir, confidence, risk, reason: 'aligned' };
}

export function selectSignal(args: {
  primary: OHLCV[];
  smc: SMCResult;
  trend: TrendResult;
  volume: VolumeResult;
  liquidity: LiquidityResult;
  volatility: VolatilityResult;
}): SignalDecision {
  const longC = evaluateDirection({ dir: 'long', ...args });
  const shortC = evaluateDirection({ dir: 'short', ...args });

  const NO_TRADE: SignalDecision = { direction: 'none', tp_price: null, sl_price: null, confidence: 0, reason: 'no trade' };

  // Tie-breaking rules
  if (longC.confidence < 40 && shortC.confidence < 40) return { ...NO_TRADE, reason: 'both below threshold' };
  if (longC.confidence >= 40 && shortC.confidence >= 40) {
    const diff = Math.abs(longC.confidence - shortC.confidence);
    if (diff < 10) return { ...NO_TRADE, reason: 'conflict (diff < 10)' };
    const winner = longC.confidence > shortC.confidence ? longC : shortC;
    return {
      direction: winner.direction,
      tp_price: winner.risk?.tp_price ?? null,
      sl_price: winner.risk?.sl_price ?? null,
      confidence: winner.confidence,
      reason: `${winner.direction} wins by ${diff}pts`,
    };
  }
  const winner = longC.confidence >= 40 ? longC : shortC;
  return {
    direction: winner.direction,
    tp_price: winner.risk?.tp_price ?? null,
    sl_price: winner.risk?.sl_price ?? null,
    confidence: winner.confidence,
    reason: winner.reason,
  };
}
