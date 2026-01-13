export interface EquityPoint {
  t: number; // timestamp ms
  v: number; // equity value
}

/**
 * Normalize an equity curve so that the first point has value 100.
 */
export function normalizeCurve(curve: EquityPoint[]): EquityPoint[] {
  if (!curve.length) return [];
  const v0 = curve[0].v;
  if (!Number.isFinite(v0) || v0 === 0) return curve.map((p) => ({ ...p }));
  return curve.map((p) => ({ t: p.t, v: (p.v / v0) * 100 }));
}

/**
 * Linearly interpolate v at targetT given a sorted curve.
 */
function interpolateAt(curve: EquityPoint[], targetT: number): number | null {
  if (!curve.length) return null;
  if (targetT <= curve[0].t) return curve[0].v;
  if (targetT >= curve[curve.length - 1].t) return curve[curve.length - 1].v;

  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].t === targetT) return curve[mid].v;
    if (curve[mid].t < targetT) lo = mid;
    else hi = mid;
  }

  const p1 = curve[lo];
  const p2 = curve[hi];
  if (p1.t === p2.t) return p1.v;
  const ratio = (targetT - p1.t) / (p2.t - p1.t);
  return p1.v + ratio * (p2.v - p1.v);
}

/**
 * Merge multiple normalized curves by averaging values at a common timestamp grid.
 *
 * - curves: array of arrays of normalized points
 * - timestamps: sorted array of timestamps to sample at
 */
export function mergeCurves(curves: EquityPoint[][], timestamps: number[]): EquityPoint[] {
  if (!curves.length || !timestamps.length) return [];

  return timestamps.map((t) => {
    let sum = 0;
    let count = 0;
    for (const curve of curves) {
      const v = interpolateAt(curve, t);
      if (v !== null && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    const v = count > 0 ? sum / count : 0;
    return { t, v };
  });
}

/**
 * Compute max drawdown (%) from a normalized curve (v around 100 baseline).
 */
export function computeDrawdown(curve: EquityPoint[]): number {
  if (!curve.length) return 0;
  let peak = curve[0].v;
  let maxDD = 0;
  for (const p of curve) {
    if (p.v > peak) peak = p.v;
    const dd = peak > 0 ? ((peak - p.v) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Compute volatility as standard deviation of successive percentage changes.
 */
export function computeVolatility(curve: EquityPoint[]): number {
  if (curve.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].v;
    const curr = curve[i].v;
    if (!Number.isFinite(prev) || prev === 0 || !Number.isFinite(curr)) continue;
    const r = (curr - prev) / prev;
    returns.push(r);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / returns.length;
  return Math.sqrt(variance);
}

export interface RStats {
  expectancy: number; // avg R
  sqn: number;        // System Quality Number
  profitFactor: number;
  stddevR: number;
}

/**
 * Compute R-multiple statistics from an array of trade R values.
 */
export function computeRStats(rValues: number[]): RStats {
  if (!rValues.length) {
    return { expectancy: 0, sqn: 0, profitFactor: 0, stddevR: 0 };
  }
  const n = rValues.length;
  const expectancy = rValues.reduce((s, r) => s + r, 0) / n;

  const mean = expectancy;
  const variance = rValues.reduce((s, r) => s + (r - mean) * (r - mean), 0) / n;
  const stddevR = Math.sqrt(variance);

  let grossProfit = 0;
  let grossLoss = 0;
  for (const r of rValues) {
    if (r > 0) grossProfit += r;
    if (r < 0) grossLoss += Math.abs(r);
  }
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const sqn = stddevR > 0 ? (expectancy * Math.sqrt(n)) / stddevR : 0;

  return { expectancy, sqn, profitFactor, stddevR };
}
