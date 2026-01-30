import type { CryptoBar } from '../../alpaca_crypto.ts';

export function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const p = Math.min(period, values.length);
  const k = 2 / (p + 1);
  const out: number[] = [];
  let emaVal = values.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = 0; i < values.length; i++) {
    if (i >= p) emaVal = values[i] * k + emaVal * (1 - k);
    out.push(emaVal);
  }
  return out;
}

export function atr(bars: CryptoBar[], period: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(0);
  if (n <= period) return out;
  let sumTR = 0;
  for (let i = 1; i <= period; i++) {
    sumTR += trueRange(bars[i - 1], bars[i]);
  }
  let atrVal = sumTR / period;
  out[period] = atrVal;
  for (let i = period + 1; i < n; i++) {
    const tr = trueRange(bars[i - 1], bars[i]);
    atrVal = ((atrVal * (period - 1)) + tr) / period;
    out[i] = atrVal;
  }
  return out;
}

function trueRange(prev: CryptoBar, cur: CryptoBar): number {
  return Math.max(
    cur.high - cur.low,
    Math.abs(cur.high - prev.close),
    Math.abs(cur.low - prev.close),
  );
}

export function swingHigh(bars: CryptoBar[], lookback = 20): number | null {
  if (bars.length < lookback) return null;
  const slice = bars.slice(-lookback);
  return Math.max(...slice.map((b) => b.high));
}

export function swingLow(bars: CryptoBar[], lookback = 20): number | null {
  if (bars.length < lookback) return null;
  const slice = bars.slice(-lookback);
  return Math.min(...slice.map((b) => b.low));
}
