// supabase/functions/_shared/backtest/engine/confluence_engine.ts
// Confluence v2: weighted scoring model per v4.8 spec

export interface ConfluenceInputs {
  smc_strength: number;   // 0-100
  trend_strength: number; // 0-100
  volume_score: number;   // 0-100
  liquidity_score: number;// 0-100
  volatility_score: number; // 0-100
}

// Official weights
const WEIGHT_SMC = 0.35;
const WEIGHT_TREND = 0.25;
const WEIGHT_VOLUME = 0.15;
const WEIGHT_LIQUIDITY = 0.15;
const WEIGHT_VOLATILITY = 0.10;

export function computeConfidence(inputs: ConfluenceInputs): number {
  const raw =
    inputs.smc_strength * WEIGHT_SMC +
    inputs.trend_strength * WEIGHT_TREND +
    inputs.volume_score * WEIGHT_VOLUME +
    inputs.liquidity_score * WEIGHT_LIQUIDITY +
    inputs.volatility_score * WEIGHT_VOLATILITY;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
