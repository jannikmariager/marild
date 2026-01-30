/**
 * DAYTRADER V4 Debug Layer
 * 
 * Instrumentation to understand why V4 produces 0 trades
 * Does NOT modify V4 logic - only adds visibility
 */

export interface V4DebugFlags {
  barIndex: number;
  timestamp: string;
  price: number;
  
  // Core conditions
  bosOk: boolean;
  liquiditySweepOk: boolean;
  orderBlockOrFvgOk: boolean;
  volumeOk: boolean;
  pricePositionOk: boolean;  // Above OB for long, below OB for short
  fvgConditionOk: boolean;    // FVG filled if required
  
  // Detailed breakdowns
  hasBullishBOS: boolean;
  hasBearishBOS: boolean;
  hasBullishSweep: boolean;
  hasBearishSweep: boolean;
  hasBullishOB: boolean;
  hasBearishOB: boolean;
  hasBullishFVG: boolean;
  hasBearishFVG: boolean;
  
  // Volume
  currentVolume: number;
  avgVolume: number;
  
  // Volatility regime
  volRegime: string;
  atrRatio: number;
  
  // Final decision
  allConditionsMet: boolean;
  direction: 'long' | 'short' | 'none';
  reason: string;
}

export interface V4DebugReport {
  ticker: string;
  v3Trades: number;
  v4Trades: number;
  totalBarsAnalyzed: number;
  
  // Failure statistics (% of bars failing each condition)
  failureStats: {
    bosFailPct: number;
    liquiditySweepFailPct: number;
    orderBlockOrFvgFailPct: number;
    volumeFailPct: number;
    pricePositionFailPct: number;
    fvgConditionFailPct: number;
  };
  
  // Most restrictive rules
  mostRestrictiveRule: string;
  mostRestrictiveRulePct: number;
  
  // Side-by-side comparisons for first 20 V3 trades
  first20Comparisons: Array<{
    barIndex: number;
    v3Triggered: boolean;
    v4Triggered: boolean;
    flags: V4DebugFlags;
  }>;
  
  // Recommendations
  recommendation: string;
}

export interface V4DebugContext {
  debugFlags: V4DebugFlags[];
  v3TradeIndices: number[];
}

/**
 * Calculate failure statistics from debug flags
 */
export function calculateFailureStats(debugFlags: V4DebugFlags[]): V4DebugReport['failureStats'] {
  if (debugFlags.length === 0) {
    return {
      bosFailPct: 0,
      liquiditySweepFailPct: 0,
      orderBlockOrFvgFailPct: 0,
      volumeFailPct: 0,
      pricePositionFailPct: 0,
      fvgConditionFailPct: 0,
    };
  }
  
  const total = debugFlags.length;
  
  return {
    bosFailPct: (debugFlags.filter(d => !d.bosOk).length / total) * 100,
    liquiditySweepFailPct: (debugFlags.filter(d => !d.liquiditySweepOk).length / total) * 100,
    orderBlockOrFvgFailPct: (debugFlags.filter(d => !d.orderBlockOrFvgOk).length / total) * 100,
    volumeFailPct: (debugFlags.filter(d => !d.volumeOk).length / total) * 100,
    pricePositionFailPct: (debugFlags.filter(d => !d.pricePositionOk).length / total) * 100,
    fvgConditionFailPct: (debugFlags.filter(d => !d.fvgConditionOk).length / total) * 100,
  };
}

/**
 * Find most restrictive rule
 */
export function findMostRestrictiveRule(stats: V4DebugReport['failureStats']): { rule: string; pct: number } {
  const rules = [
    { name: 'BOS', pct: stats.bosFailPct },
    { name: 'Liquidity Sweep', pct: stats.liquiditySweepFailPct },
    { name: 'Order Block or FVG', pct: stats.orderBlockOrFvgFailPct },
    { name: 'Volume', pct: stats.volumeFailPct },
    { name: 'Price Position', pct: stats.pricePositionFailPct },
    { name: 'FVG Condition', pct: stats.fvgConditionFailPct },
  ];
  
  const mostRestrictive = rules.reduce((max, rule) => rule.pct > max.pct ? rule : max, rules[0]);
  
  return { rule: mostRestrictive.name, pct: mostRestrictive.pct };
}

/**
 * Generate recommendation based on failure stats
 */
export function generateRecommendation(stats: V4DebugReport['failureStats']): string {
  const recommendations: string[] = [];
  
  if (stats.bosFailPct > 80) {
    recommendations.push('BOS detection too strict - consider relaxing swing point requirements');
  }
  
  if (stats.liquiditySweepFailPct > 80) {
    recommendations.push('Liquidity sweep too rare - widen sweep tolerance or lookback window');
  }
  
  if (stats.orderBlockOrFvgFailPct > 80) {
    recommendations.push('Order block/FVG requirements too strict - relax displacement threshold');
  }
  
  if (stats.volumeFailPct > 60) {
    recommendations.push(`Volume filter kills ${stats.volumeFailPct.toFixed(1)}% of setups - lower threshold from 0.5× to 0.3× avg volume`);
  }
  
  if (stats.pricePositionFailPct > 60) {
    recommendations.push('Price position check too strict - widen OB zone tolerance');
  }
  
  if (stats.fvgConditionFailPct > 60) {
    recommendations.push('FVG fill requirement too strict - make it optional in more regimes');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('V4 conditions are balanced but too strict overall - consider 2-3 conditions instead of ALL');
  }
  
  return recommendations.join('; ');
}
