/**
 * OHLC WINDOWING & SANITIZATION (v4.8)
 *
 * Same logic as v4/v4_7 to ensure consistency.
 */

import { OHLCBar, EngineType } from "../../signal_types.ts";

export interface SanitizedBarsResult {
  bars: OHLCBar[];
  anomalies: string[];
  insufficient: boolean;
}

function getEngineMinBars(engine: EngineType): number {
  switch (engine) {
    case "DAYTRADER":
      return 300;
    case "SWING":
      return 40;
    case "INVESTOR":
      return 200;
    default:
      return 0;
  }
}

export function sanitizeBars(
  engine: EngineType,
  rawBars: OHLCBar[],
): SanitizedBarsResult {
  const anomalies: string[] = [];

  if (!rawBars || rawBars.length === 0) {
    anomalies.push("no_bars_loaded");
    return { bars: [], anomalies, insufficient: true };
  }

  let zeroVolumeCount = 0;
  let invalidCount = 0;

  const cleaned: OHLCBar[] = [];

  for (const bar of rawBars) {
    const o = Number(bar.open);
    const h = Number(bar.high);
    const l = Number(bar.low);
    const c = Number(bar.close);
    const v = Number(bar.volume ?? 0);

    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      invalidCount++;
      continue;
    }

    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
      invalidCount++;
      continue;
    }

    if (!Number.isFinite(new Date(bar.timestamp).getTime())) {
      invalidCount++;
      continue;
    }

    if (!Number.isFinite(v) || v < 0) {
      invalidCount++;
      continue;
    }

    if (v === 0) zeroVolumeCount++;

    cleaned.push({ ...bar, open: o, high: h, low: l, close: c, volume: v });
  }

  if (invalidCount > 0) {
    anomalies.push(`invalid_ohlc_bars:${invalidCount}`);
  }

  if (zeroVolumeCount > 0) {
    anomalies.push(`zero_volume_bars:${zeroVolumeCount}`);
  }

  cleaned.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const minRequired = getEngineMinBars(engine);
  const insufficient = cleaned.length < minRequired;

  if (insufficient) {
    anomalies.push(`insufficient_bars:${cleaned.length}/${minRequired}`);
  }

  return { bars: cleaned, anomalies, insufficient };
}
