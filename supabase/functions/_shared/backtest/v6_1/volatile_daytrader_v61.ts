// supabase/functions/_shared/backtest/v6_1/volatile_daytrader_v61.ts
//
// ENGINE C (v6.1): High-volatility / breakout micro-engine for DAYTRADER.
//
// Applies the shared v6.1 gating (confidence, SMC+volume, ATR, RR) while
// retaining the v6.0 focus on compression→expansion and volume spikes.

import type { OHLCBar, EngineType, FundamentalsData } from "../../signal_types.ts";
import { loadUnifiedOHLC } from "../../ohlc_loader.ts";
import { evaluateSignalV48 } from "../engine/engine_core_v48.ts";
import { evaluateExits } from "../engine/exits_engine.ts";
import { runSMCEngine } from "../engine/smc_engine.ts";
import type { MultiTimeframeInput, TFName, EngineSignalV48 } from "../engine/types.ts";
import type { DayEngineContextV60 } from "../v6_0/daytrader_router_v60.ts";
import type { ExecutionResultV61, TradeV61 } from "./trend_daytrader_v61.ts";
import { classifyRegime, shouldBlockByGlobalGates } from "./shared_v61_gates.ts";

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

const EXECUTION_PROFILE = { slippageBps: 3, spreadBps: 2, maxHoldBars: 40 } as const;

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
  const riskPct = 0.003; // slightly higher risk per trade for volatile names
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

export async function runVolatileDaytraderV61(
  engineType: EngineType,
  symbol: string,
  bars: OHLCBar[],
  startingEquity: number,
  _fundamentals: FundamentalsData | undefined,
  ctx: DayEngineContextV60,
): Promise<ExecutionResultV61> {
  const engine_version = "v6.1/volatile";

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

      if (shouldBlockByGlobalGates(signal, meta, barNext.close, filterReasons)) {
        filteredSignals++;
        continue;
      }

      const trendStrength = Number(meta?.trend?.strength ?? 0);
      const volState = String(meta?.volatility?.state ?? "normal");
      const volMetrics = meta?.volatility ?? {};

      // Block meltdown regimes: extreme vol + very negative trend strength
      if (volState === "extreme" && trendStrength < -40) {
        filteredSignals++;
        filterReasons["meltdown_block_v61_volatile"] =
          (filterReasons["meltdown_block_v61_volatile"] ?? 0) + 1;
        continue;
      }

      const regime = classifyRegime(signal as any);

      // Look for compression→expansion proxy flags from volatility metadata if present
      const compressedRecently = Boolean(volMetrics?.was_compressed_recently ?? false);
      const expandingNow = Boolean(volMetrics?.is_expanding_now ?? false);
      if (!compressedRecently || !expandingNow) {
        filteredSignals++;
        filterReasons["no_compress_expand_v61_volatile"] =
          (filterReasons["no_compress_expand_v61_volatile"] ?? 0) + 1;
        continue;
      }

      const volume = meta?.volume ?? {};
      if (!volume.spike && !volume.climax) {
        filteredSignals++;
        filterReasons["no_volume_spike_v61_volatile"] =
          (filterReasons["no_volume_spike_v61_volatile"] ?? 0) + 1;
        continue;
      }

      totalSignals++;

      const entryPrice = applyEntrySlippage(barNext.open, signal.direction as any);
      const sl = signal.sl_price;
      const tp = signal.tp_price;
      const size = computePositionSize(equity, entryPrice, sl);
      if (size <= 0) {
        filteredSignals++;
        filterReasons["size_zero_v61_volatile"] =
          (filterReasons["size_zero_v61_volatile"] ?? 0) + 1;
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
