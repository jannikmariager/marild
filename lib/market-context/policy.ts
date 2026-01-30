export type MarketContextRegime = 'normal' | 'moderate_risk' | 'high_risk';

export type MarketContextTradeGate = 'OPEN' | 'CLOSE';

export interface MarketContextSnapshot {
  asOf: string;
  vix?: number | null;
  vixPercentile?: number | null;
  /**
   * Aggregate equity index futures gap as percent of spot (e.g. ES). Positive for gap up, negative for gap down.
   */
  futuresGapPct?: number | null;
  realizedVol?: number | null;
  /**
   * Negative values indicate risk-off breadth (e.g. many stocks below key MAs); 0 is neutral.
   */
  breadthRiskOffScore?: number | null;
}

export interface MarketContextPolicyConfig {
  /** VIX level above which we consider conditions "moderately" stressed. */
  vixModerate: number;
  /** VIX level above which we consider conditions "high" risk. */
  vixHigh: number;
  /** Absolute futures gap (in pct) considered moderate. */
  gapModerate: number;
  /** Absolute futures gap (in pct) considered high. */
  gapHigh: number;
  /** Breadth/risk-off score below which regime escalates. */
  breadthRiskOffThreshold: number;
  /** Risk scale for normal regime (usually 1.0). */
  normalRiskScale: number;
  /** Risk scale for moderate-risk regime (e.g. 0.5). */
  moderateRiskScale: number;
  /** Risk scale for high-risk regime (e.g. 0.0–0.25). */
  highRiskScale: number;
  /** Optional max-position caps per regime. */
  normalMaxPositions?: number | null;
  moderateMaxPositions?: number | null;
  highMaxPositions?: number | null;
}

export interface MarketContextDecision {
  policyVersion: 'CTX_V1_MINIMAL';
  asOf: string;
  regime: MarketContextRegime;
  tradeGate: MarketContextTradeGate;
  riskScale: number;
  maxPositionsOverride: number | null;
  notes: string[];
}

export function defaultPolicyConfig(): MarketContextPolicyConfig {
  return {
    vixModerate: 18,
    vixHigh: 25,
    gapModerate: 0.8, // 0.8% overnight gap
    gapHigh: 1.5, // 1.5%+ considered stressed
    breadthRiskOffThreshold: -0.5,
    normalRiskScale: 1.0,
    moderateRiskScale: 0.5,
    highRiskScale: 0.0,
    normalMaxPositions: null,
    moderateMaxPositions: null,
    highMaxPositions: null,
  };
}

export function deriveContextRegime(
  snapshot: MarketContextSnapshot,
  config: MarketContextPolicyConfig = defaultPolicyConfig(),
): { regime: MarketContextRegime; reasons: string[] } {
  const reasons: string[] = [];

  const vix = coerceNumber(snapshot.vix ?? snapshot.vixPercentile);
  const gapAbs = Math.abs(coerceNumber(snapshot.futuresGapPct));
  const breadth = coerceNumber(snapshot.breadthRiskOffScore);

  let regime: MarketContextRegime = 'normal';

  if (vix !== null) {
    if (vix >= config.vixHigh) {
      regime = 'high_risk';
      reasons.push(`VIX=${vix.toFixed(2)} >= high threshold ${config.vixHigh}`);
    } else if (vix >= config.vixModerate) {
      regime = maxRegime(regime, 'moderate_risk');
      reasons.push(`VIX=${vix.toFixed(2)} >= moderate threshold ${config.vixModerate}`);
    }
  }

  if (gapAbs !== null) {
    if (gapAbs >= config.gapHigh) {
      regime = 'high_risk';
      reasons.push(`|futures_gap|=${gapAbs.toFixed(2)}% >= high threshold ${config.gapHigh}%`);
    } else if (gapAbs >= config.gapModerate) {
      regime = maxRegime(regime, 'moderate_risk');
      reasons.push(`|futures_gap|=${gapAbs.toFixed(2)}% >= moderate threshold ${config.gapModerate}%`);
    }
  }

  if (breadth !== null && breadth <= config.breadthRiskOffThreshold) {
    // Breadth confirms risk-off; escalate to at least moderate.
    regime = maxRegime(regime, 'moderate_risk');
    reasons.push(
      `breadth_riskoff_score=${breadth.toFixed(2)} <= threshold ${config.breadthRiskOffThreshold.toFixed(2)}`,
    );
  }

  return { regime, reasons };
}

export function evaluateMarketContext(
  policyVersion: 'CTX_V1_MINIMAL',
  snapshot: MarketContextSnapshot,
  config: MarketContextPolicyConfig = defaultPolicyConfig(),
): MarketContextDecision {
  const { regime, reasons } = deriveContextRegime(snapshot, config);

  let tradeGate: MarketContextTradeGate = 'OPEN';
  let riskScale = config.normalRiskScale;
  let maxPositionsOverride: number | null = null;

  if (regime === 'moderate_risk') {
    tradeGate = 'OPEN';
    riskScale = config.moderateRiskScale;
    maxPositionsOverride = coerceInt(config.moderateMaxPositions);
  } else if (regime === 'high_risk') {
    // In CTX_V1_MINIMAL we choose a conservative default: gate closed when
    // both vol and gaps are stressed. The exact thresholds are driven by config.
    tradeGate = 'CLOSE';
    riskScale = config.highRiskScale;
    maxPositionsOverride = coerceInt(config.highMaxPositions);
  } else {
    tradeGate = 'OPEN';
    riskScale = config.normalRiskScale;
    maxPositionsOverride = coerceInt(config.normalMaxPositions);
  }

  const asOf = snapshot.asOf ?? new Date().toISOString();

  const notes: string[] = [];
  if (reasons.length === 0) {
    notes.push('CTX_V1_MINIMAL: No stress conditions detected; using normal regime.');
  } else {
    notes.push('CTX_V1_MINIMAL: Derived regime from market context.');
    notes.push(...reasons);
  }

  return {
    policyVersion,
    asOf,
    regime,
    tradeGate,
    riskScale,
    maxPositionsOverride,
    notes,
  };
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceInt(value: unknown): number | null {
  const n = coerceNumber(value);
  if (n === null) return null;
  const rounded = Math.round(n);
  return Number.isFinite(rounded) ? rounded : null;
}

function maxRegime(a: MarketContextRegime, b: MarketContextRegime): MarketContextRegime {
  const order: MarketContextRegime[] = ['normal', 'moderate_risk', 'high_risk'];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}
