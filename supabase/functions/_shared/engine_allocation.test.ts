import {
  computeAllocationMetrics,
  computeAllocationScore,
  getOwnerOrBaseline,
  meetsPromotionDelta,
} from './engine_allocation.ts';

Deno.test('computeAllocationMetrics handles positive/negative R values', () => {
  const metrics = computeAllocationMetrics([
    { closed_at: new Date().toISOString(), realized_r: 1.2 },
    { closed_at: new Date().toISOString(), realized_r: -0.5 },
    { closed_at: new Date().toISOString(), realized_r: 0.3 },
  ]);

  if (metrics.trades !== 3) throw new Error('expected 3 trades');
  if (Math.abs(metrics.expectancyR - 0.3333) > 0.001) {
    throw new Error(`unexpected expectancy ${metrics.expectancyR}`);
  }
  if (metrics.maxDdR <= 0) throw new Error('max drawdown should be positive');
  if (metrics.winRate <= 0) throw new Error('win rate should be positive');
  if (metrics.profitFactor <= 1) throw new Error('profit factor should be > 1');
});

Deno.test('computeAllocationScore applies weighting', () => {
  const metrics = {
    trades: 5,
    expectancyR: 0.4,
    maxDdR: 1,
    stability: 0.2,
    winRate: 60,
    profitFactor: 2,
  };
  const score = computeAllocationScore(metrics);
  if (Math.abs(score - ((0.4 * 100) - (1 * 50) - (0.2 * 10))) > 0.001) {
    throw new Error(`unexpected score ${score}`);
  }
});

Deno.test('meetsPromotionDelta enforces multiplier thresholds', () => {
  const currentScore = 50;
  const currentExp = 0.2;
  const candidateScore = 65; // 30% lift
  const candidateExp = 0.35; // +0.15

  if (!meetsPromotionDelta(currentScore, currentExp, candidateScore, candidateExp)) {
    throw new Error('should meet delta');
  }
  if (meetsPromotionDelta(currentScore, currentExp, 55, 0.25)) {
    throw new Error('should not meet delta when thresholds barely change');
  }
});

Deno.test('getOwnerOrBaseline falls back to baseline values', () => {
  const owners = new Map<string, any>();
  const owner = getOwnerOrBaseline(owners, 'TSLA');
  if (owner.active_engine_key !== 'SWING' || owner.active_engine_version !== 'BASELINE') {
    throw new Error('expected baseline fallback');
  }
});
