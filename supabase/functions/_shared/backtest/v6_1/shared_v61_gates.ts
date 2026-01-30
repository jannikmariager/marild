// supabase/functions/_shared/backtest/v6_1/shared_v61_gates.ts
//
// Shared helpers for v6.1 DAYTRADER engines: regime classification and
// the relaxed-but-structured gating logic described in the v6.1 spec.

import type { EngineSignalV48 } from "../engine/types.ts";

export type RegimeLabel = "TREND" | "RANGE" | "EXPANSION" | "CONTRA";

export function classifyRegime(signal: EngineSignalV48): RegimeLabel {
  const { trend, volatility } = (signal.metadata ?? {}) as any;
  const trendStrength = Number(trend?.strength ?? 0);
  const volState = String(volatility?.state ?? "normal");

  if (volState === "extreme") return "EXPANSION";
  if (trendStrength < 25 && volState === "low") return "RANGE";
  if (volState === "high" && trendStrength >= 35) return "EXPANSION";
  if (trendStrength >= 35 && volState !== "extreme") return "TREND";
  return "CONTRA";
}

const MIN_CONF_DAY_V61 = 44;
const MIN_TREND_FOR_CONTRA_BLOCK = 20;
const ATR_EXTREME_LIMIT_V61 = 3.0;
const MIN_RR_DAY_V61 = 1.3;

export function shouldBlockByGlobalGates(
  signal: any,
  meta: any,
  priceClose: number,
  filterReasons: Record<string, number>,
): boolean {
  // 1) Confidence gate
  const rawConf = Number(signal.confidence ?? meta?.confidence ?? meta?.score ?? 0);
  const confidence = Number.isFinite(rawConf) ? rawConf : 0;
  if (confidence < MIN_CONF_DAY_V61) {
    filterReasons["confidence_below_44_v61"] = (filterReasons["confidence_below_44_v61"] ?? 0) + 1;
    return true;
  }

  const trend = meta?.trend ?? {};
  const trendStrength = Number(trend.strength ?? 0);
  const volatility = meta?.volatility ?? {};
  const volState = String(volatility.state ?? "normal");
  const regimeStr = classifyRegime(signal as any);
  const isContra = regimeStr === "CONTRA";

  // 2) Contra-trend / regime blocking with SMC+volume override
  if (trendStrength < MIN_TREND_FOR_CONTRA_BLOCK && isContra) {
    const smc = meta?.smc ?? {};
    const volume = meta?.volume ?? {};
    const smcStrength = Number(smc.strength ?? smc.score ?? 0);
    const volumeScore = Number(volume.score ?? 0);
    const confluenceScore =
      (Number.isFinite(smcStrength) ? smcStrength : 0) +
      (Number.isFinite(volumeScore) ? volumeScore : 0);
    if (confluenceScore < 70) {
      filterReasons["v61_contra_block_day"] = (filterReasons["v61_contra_block_day"] ?? 0) + 1;
      return true;
    }
  }

  // 3) Range regime allowance – only block mid-range with no OB context
  if (regimeStr === "RANGE") {
    const smc = meta?.smc ?? {};
    const obHigh = Number(smc.nearestBullishObHigh ?? smc.nearest_bullish_ob_high ?? NaN);
    const obLow = Number(smc.nearestBearishObLow ?? smc.nearest_bearish_ob_low ?? NaN);
    const aboveOb = Number.isFinite(obHigh) && priceClose > obHigh;
    const belowOb = Number.isFinite(obLow) && priceClose < obLow;

    if (!aboveOb && !belowOb) {
      filterReasons["v61_range_mid_block_day"] =
        (filterReasons["v61_range_mid_block_day"] ?? 0) + 1;
      return true;
    }
  }

  // 4) SMC confluence (BOS/CHoCH + OB)
  {
    const smc = meta?.smc ?? {};
    const hasStrongBos = smc.bos === true && Number(smc.displacement ?? smc.bos_displacement ?? 0) >= 1.2;
    const hasStrongChoCh =
      (smc.choch === true || smc.choch_valid === true) &&
      Number(smc.chochStrength ?? smc.choch_strength ?? 0) >= 35;
    const hasObAlignment =
      Boolean(smc.nearestObInDirection ?? smc.nearest_ob_in_direction) &&
      Number(smc.obQuality ?? smc.ob_quality ?? 0) >= 35;

    const smcConfluence =
      (hasStrongBos && hasObAlignment) ||
      (hasStrongChoCh && hasObAlignment);

    if (!smcConfluence) {
      filterReasons["v61_smc_weak_day"] = (filterReasons["v61_smc_weak_day"] ?? 0) + 1;
      return true;
    }
  }

  // 5) Volume gating (spike OR sustained above mean)
  {
    const volume = meta?.volume ?? {};
    const zScore = Number(volume.zScore ?? volume.z_score ?? 0);
    const hasVolumeSpike = (volume.spike || volume.climax) && zScore >= 1.5;
    const sustainedBars = Number(volume.persistentAboveMeanBars ?? volume.persistent_above_mean_bars ?? 0);
    const hasSustainedVolume = sustainedBars >= 3;

    if (!hasVolumeSpike && !hasSustainedVolume) {
      filterReasons["v61_volume_weak_day"] = (filterReasons["v61_volume_weak_day"] ?? 0) + 1;
      return true;
    }
  }

  // 6) ATR / volatility extremes
  {
    const atrMultiple = Number(volatility.atrMultiple ?? volatility.atr_multiple ?? 0);
    if (atrMultiple > ATR_EXTREME_LIMIT_V61) {
      filterReasons["v61_atr_extreme_day"] = (filterReasons["v61_atr_extreme_day"] ?? 0) + 1;
      return true;
    }
  }

  // 7) RR enforcement (approximate, based on current close as would-be entry)
  if (signal.sl_price != null && signal.tp_price != null && Number.isFinite(priceClose)) {
    const entryApprox = priceClose;
    const sl = Number(signal.sl_price);
    const tp = Number(signal.tp_price);
    const rrNumerator = Math.abs(tp - entryApprox);
    const rrDenom = Math.abs(entryApprox - sl);
    if (rrDenom > 0) {
      const rr = rrNumerator / rrDenom;
      if (rr < MIN_RR_DAY_V61) {
        filterReasons["v61_rr_too_low_day"] = (filterReasons["v61_rr_too_low_day"] ?? 0) + 1;
        return true;
      }
    }
  }

  return false;
}
