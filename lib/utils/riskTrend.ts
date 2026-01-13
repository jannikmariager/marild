/**
 * Correction Risk Trend Helper
 * Determines risk trend direction and appropriate color
 */

export type RiskTrendDirection = 'improving' | 'worsening' | 'neutral';

/**
 * Analyzes risk trend array and returns direction
 * - Decreasing risk = IMPROVING (safer)
 * - Increasing risk = WORSENING (more dangerous)
 * - Flat = NEUTRAL
 */
export function getRiskTrendDirection(trend: number[]): RiskTrendDirection {
  if (!trend || trend.length < 2) return 'neutral';

  const first = trend[0];
  const last = trend[trend.length - 1];
  const diff = last - first;

  // Essentially flat (within 0.5% tolerance)
  if (Math.abs(diff) < 0.005) return 'neutral';

  // Risk decreasing = improving situation
  if (diff < 0) return 'improving';

  // Risk increasing = worsening situation
  return 'worsening';
}

/**
 * Trading-safe color mapping for risk trends
 * Different from buy/sell colors to avoid confusion
 */
export const RISK_COLORS = {
  improving: '#0AAE84',  // Mint green (safe, risk decreasing)
  worsening: '#E65A5A',  // Soft red (warning, risk increasing)
  neutral: '#F4B740',    // Soft amber (stable)
} as const;

/**
 * Get color for risk trend sparkline
 */
export function getRiskTrendColor(trend: number[]): string {
  const direction = getRiskTrendDirection(trend);
  return RISK_COLORS[direction];
}
