// supabase/functions/_shared/backtest/v6_1/trend_daytrader_v61.ts
//
// ENGINE A (v6.1): Trend continuation micro-engine for DAYTRADER.
//
// This is a tuned clone of the v6.0 trend engine with relaxed but
// structured gating so that it actually trades while still enforcing
// quality via confidence, SMC, volume, volatility, and RR checks.

import type { OHLCBar, EngineType, FundamentalsData } from "../../signal_types.ts";
import { loadUnifiedOHLC } from "../../ohlc_loader.ts";
import { evaluateSignalV48 } from "../engine/engine_core_v48.ts";
import { evaluateExits } from "../engine/exits_engine.ts";
import { runSMCEngine } from "../engine/smc_engine.ts";
import type { MultiTimeframeInput, TFName, EngineSignalV48 } from "../engine/types.ts";
import type { DayEngineContextV60 } from "../v6_0/daytrader_router_v60.ts";

export interface TradeV61 {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp: number;
  direction: "long" | "short";
  rMultiple: number;
  pnl: number;
  win: boolean;
  exitReason?: string;
}

export interface ExecutionResultV61 {
  trades: TradeV61[];
  equityCurve: Array<{ t: number; balance: number }>;
  filteredSignals: number;
  totalSignals: number;
  filterReasons: Record<string, number>;
  lastMetadata?: {
    engine_version: string; // e.g. "v6.1/trend"
    behavior: string;
    engine_id: string;
    regime?: string;
    volatility_state?: string;
  };
}

const SMC_LOOKBACK_BARS = 800;

function primaryTfFromEngine(e: EngineType): TFName {
  switch (e) {
    case "DAYTRADER":
      return "1m";
    case "SWING":
      return "4h";
    case "INVESTOR":
    default:
      return "1d";
  }
}

function buildSyntheticMTF(bars: OHLCBar[]): MultiTimeframeInput {
  return { tf_1m: bars, tf_5m: bars, tf_15m: bars, tf_1h: bars, tf_4h: bars, tf_1d: bars };
}

async function buildMultiTimeframeInput(
  engineType: EngineType,
  symbol: string,
  primaryBars: OHLCBar[],
): Promise<MultiTimeframeInput> {
  if (!primaryBars.length) return buildSyntheticMTF(primaryBars);

  const firstTs = new Date(primaryBars[0].timestamp).getTime();
  const lastTs = new Date(primaryBars[primaryBars.length - 1].timestamp).getTime();
  const clamp = (bars: OHLCBar[]) =>
    bars.filter((b) => {
      const ms = new Date(new Date(b.timestamp).toISOString()).getTime();
      return ms >= firstTs && ms <= lastTs;
    });

  try {
    if (engineType === "DAYTRADER") {
      const [tf5m, tf15m, tf1h, tf4h, tf1d] = await Promise.all([
        loadUnifiedOHLC(symbol, "5m"),
        loadUnifiedOHLC(symbol, "15m"),
        loadUnifiedOHLC(symbol, "1h"),
        loadUnifiedOHLC(symbol, "4h"),
        loadUnifiedOHLC(symbol, "1d"),
      ]);
      return {
        tf_1m: primaryBars,
        tf_5m: clamp(tf5m.length ? tf5m : primaryBars),
        tf_15m: clamp(tf15m.length ? tf15m : primaryBars),
        tf_1h: clamp(tf1h.length ? tf1h : primaryBars),
        tf_4h: clamp(tf4h.length ? tf4h : primaryBars),
        tf_1d: clamp(tf1d.length ? tf1d : primaryBars),
      };
    }

    return buildSyntheticMTF(primaryBars);
  } catch {
    return buildSyntheticMTF(primaryBars);
  }
}

// Simple regime classifier reused from v5.x
function classifyRegime(signal: EngineSignalV48): "TREND" | "RANGE" | "EXPANSION" | "CONTRA" {
  const { trend, volatility } = signal.metadata as any;
  const trendStrength = Number(trend?.strength ?? 0);
  const volState = String(volatility?.state ?? "normal");

  if (volState === "extreme") return "EXPANSION";
  if (trendStrength < 25 && volState === "low") return "RANGE";
  if (volState === "high" && trendStrength >= 35) return "EXPANSION";
  if (trendStrength >= 35 && volState !== "extreme") return "TREND";
  return "CONTRA";
}

const EXECUTION_PROFILE = { slippageBps: 2, spreadBps: 1, maxHoldBars: 60 } as const;

function applyEntrySlippage(rawPrice: number, direction: "long" | "short"): number {
  const bps = EXECUTION_PROFILE.slippageBps + EXECUTION_PROFILE.spreadBps;
  const factor = bps / 10_000;
  return direction === "long" ? rawPrice * (1 + factor) : rawPrice * (1 - factor);
}

function applyExitSlippage(rawPrice: number, direction: "long" | "short"): number {
  const bps = EXECUTION_PROFILE.slippageBps + EXECUTION_PROFILE.spreadBps;
  const factor = bps / 10_000;
  return direction === "long" ? rawPrice * (1 - factor) : rawPrice * (1 + factor);
}

function computePositionSize(equity: number, entryPrice: number, sl: number): number {
  const dist = Math.abs(entryPrice - sl);
  if (dist <= 0 || equity <= 0) return 0;
  const riskPct = 0.0025; // 0.25% per trade for intraday
  return (equity * riskPct) / dist;
}

function computeRMultiple(dir: "long" | "short", entry: number, exit: number, sl: number): number {
  const denom = dir === "long" ? entry - sl : sl - entry;
  if (denom === 0) return 0;
  const num = dir === "long" ? exit - entry : entry - exit;
  return num / denom;
}

function computePnl(dir: "long" | "short", entry: number, exit: number, size: number): number {
  const delta = dir === "long" ? exit - entry : entry - exit;
  return delta * size;
}

interface OpenPosition {
  entryIndex: number;
  entryTime: string;
  entryPrice: number;
  sl: number;
  tp: number;
  direction: "long" | "short";
  size: number;
}

// ---------------------------------------------------------------------------
// Shared v6.1 gating helpers
// ---------------------------------------------------------------------------

const MIN_CONF_DAY_V61 = 44;
const MIN_TREND_FOR_CONTRA_BLOCK = 20;
const ATR_EXTREME_LIMIT_V61 = 3.0;
const MIN_RR_DAY_V61 = 1.3;

function shouldBlockByGlobalGates(
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

export async function runTrendDaytraderV61(
  engineType: EngineType,
  symbol: string,
  bars: OHLCBar[],
  startingEquity: number,
  _fundamentals: FundamentalsData | undefined,
  ctx: DayEngineContextV60,
): Promise<ExecutionResultV61> {
  const engine_version = "v6.1/trend";

  const trades: TradeV61[] = [];
  const equityCurve: Array<{ t: number; balance: number }> = [];
  let equity = startingEquity;
  let openPos: OpenPosition | null = null;

  if (!bars || bars.length < 2) {
    return { trades, equityCurve, filteredSignals: 0, totalSignals: 0, filterReasons: {} };
  }

  const primaryTf = primaryTfFromEngine(engineType);
  const mtf = await buildMultiTimeframeInput(engineType, symbol, bars);

  let totalSignals = 0;
  let filteredSignals = 0;
  const filterReasons: Record<string, number> = {};
  let lastMetadata: ExecutionResultV61["lastMetadata"];

  const firstTs = new Date(bars[0].timestamp).getTime();
  equityCurve.push({ t: firstTs, balance: equity });

  for (let i = 0; i < bars.length - 1; i++) {
    const barCurr = bars[i];
    const barNext = bars[i + 1];
    const tsNext = new Date(barNext.timestamp).getTime();

    // Manage open position exits
    if (openPos) {
      const endIdx = i + 2;
      const startIdx = Math.max(0, endIdx - SMC_LOOKBACK_BARS);
      const windowBars = bars.slice(startIdx, endIdx);
      const smc = runSMCEngine(windowBars);
      const exitSignal = evaluateExits({
        direction: openPos.direction,
        entryPrice: openPos.entryPrice,
        currentSL: openPos.sl,
        currentTP: openPos.tp,
        bars: windowBars,
        smc,
        entryOB: undefined,
      });

      const low = barNext.low,
        high = barNext.high,
        close = barNext.close;
      const slHit = openPos.direction === "long" ? low <= openPos.sl : high >= openPos.sl;
      const tpHit = openPos.direction === "long" ? high >= openPos.tp : low <= openPos.tp;

      let exitPrice: number | null = null;
      let exitReason = "";

      if (exitSignal.should_exit) {
        exitPrice = applyExitSlippage(close, openPos.direction);
        exitReason = exitSignal.reason ?? "dynamic_exit";
      } else if (slHit && tpHit) {
        exitPrice = applyExitSlippage(openPos.sl, openPos.direction);
        exitReason = "sl_and_tp_hit_sl_preferred";
      } else if (slHit) {
        exitPrice = applyExitSlippage(openPos.sl, openPos.direction);
        exitReason = "sl_hit";
      } else if (tpHit) {
        exitPrice = applyExitSlippage(openPos.tp, openPos.direction);
        exitReason = "tp_hit";
      } else if (
        EXECUTION_PROFILE.maxHoldBars !== null &&
        i + 1 - openPos.entryIndex >= EXECUTION_PROFILE.maxHoldBars
      ) {
        exitPrice = applyExitSlippage(close, openPos.direction);
        exitReason = "max_hold_exit";
      }

      if (exitSignal.new_sl !== undefined && !exitPrice) {
        openPos.sl = exitSignal.new_sl;
      }

      if (exitPrice !== null) {
        const pnl = computePnl(openPos.direction, openPos.entryPrice, exitPrice, openPos.size);
        const rMult = computeRMultiple(
          openPos.direction,
          openPos.entryPrice,
          exitPrice,
          openPos.sl,
        );
        equity += pnl;
        trades.push({
          entryTime: openPos.entryTime,
          exitTime: barNext.timestamp,
          entryPrice: openPos.entryPrice,
          exitPrice,
          sl: openPos.sl,
          tp: openPos.tp,
          direction: openPos.direction,
          rMultiple: rMult,
          pnl,
          win: rMult > 0,
          exitReason,
        });
        openPos = null;
      }
    }

    equityCurve.push({ t: tsNext, balance: equity });

    // Evaluate entries when flat (DAYTRADER only)
    if (!openPos && engineType === "DAYTRADER") {
      const signal = evaluateSignalV48({
        symbol,
        engineType,
        primaryTf,
        mtf,
        currentIndexPrimary: i,
      });

      if (signal.direction === "none" || !signal.sl_price || !signal.tp_price) {
        continue;
      }

      const meta: any = signal.metadata ?? {};

      // Apply shared v6.1 gating logic
      if (shouldBlockByGlobalGates(signal, meta, barNext.close, filterReasons)) {
        filteredSignals++;
        continue;
      }

      // Trend engine still requires clear trend and non-extreme volatility
      const trendStrength = Number(meta?.trend?.strength ?? 0);
      const volState = String(meta?.volatility?.state ?? "normal");
      const regime = classifyRegime(signal as any);

      if (trendStrength < 30) {
        filteredSignals++;
        filterReasons["trend_weak_v61_trend"] = (filterReasons["trend_weak_v61_trend"] ?? 0) + 1;
        continue;
      }
      if (volState === "extreme") {
        filteredSignals++;
        filterReasons["vol_extreme_v61_trend"] =
          (filterReasons["vol_extreme_v61_trend"] ?? 0) + 1;
        continue;
      }

      totalSignals++;

      const entryPrice = applyEntrySlippage(barNext.open, signal.direction as any);
      const sl = signal.sl_price;
      const tp = signal.tp_price;
      const size = computePositionSize(equity, entryPrice, sl);
      if (size <= 0) {
        filteredSignals++;
        filterReasons["size_zero_v61_trend"] = (filterReasons["size_zero_v61_trend"] ?? 0) + 1;
        continue;
      }

      openPos = {
        entryIndex: i + 1,
        entryTime: barNext.timestamp,
        entryPrice,
        sl,
        tp,
        direction: signal.direction as any,
        size,
      };

      lastMetadata = {
        engine_version,
        behavior: ctx.behavior,
        engine_id: ctx.engineId,
        regime,
        volatility_state: volState,
      };
    }
  }

  return { trades, equityCurve, filteredSignals, totalSignals, filterReasons, lastMetadata };
}
