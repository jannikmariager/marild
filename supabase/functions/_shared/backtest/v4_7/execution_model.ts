/**
 * EXECUTION MODEL (Backtest V4)
 *
 * Implements a simple, deterministic execution model with optional
 * "V4.6" execution realism and filter layers:
 * - At each bar N (on close), we evaluate an entry signal.
 * - If a new position should be opened, entry is at OPEN of bar N+1
 *   (optionally adjusted for slippage/spread).
 * - SL/TP are checked intrabar on every subsequent bar using a
 *   pessimistic assumption if both could be hit in the same bar.
 * - Optional max-hold exit caps overly long trades.
 * - Optional trend/volatility/volume filters gate which signals are
 *   actually executed, while preserving the underlying signal model.
 *
 * This module assumes a single position at a time per symbol.
 */

import { OHLCBar, EngineType, FundamentalsData } from "../../signal_types.ts";
import { evaluateEngineSignal } from "./engine_signal_eval.ts";
import { computePositionSize, computeRMultiple, computePnl } from "./risk_model.ts";
import { loadUnifiedOHLC, type SupportedTimeframe } from "../../ohlc_loader.ts";
import {
  computeHtfBias,
  isTradeAlignedWithHtf,
  type HtfBias,
  DEFAULT_V47_HTF_CONFIG,
  V47_FEATURE_FLAGS,
  findHtfBarIndexForEntry,
} from "./htf_alignment_v4_7.ts";

// Feature flags so V4.6 behavior can be dialed back if needed without
// touching public APIs.
const ENABLE_V46_EXECUTION = true;
const ENABLE_V46_FILTERS = true;

export type ExecutionProfile = {
  entryMode: "next_bar_open"; // kept extensible
  slippageBps: number;        // per side
  spreadBps: number;          // effective spread cost
  maxHoldBars: number | null; // max bars to hold position
  regularSessionOnly: boolean;
};

export type FilterProfile = {
  useTrendFilter: boolean;
  trendEmaPeriod: number;
  useAtrFilter: boolean;
  minAtrRatio: number; // ATR/price
  useVolumeFilter: boolean;
  minVolume: number;
};

const EXECUTION_PROFILES: Record<EngineType, ExecutionProfile> = {
  DAYTRADER: {
    entryMode: "next_bar_open",
    slippageBps: 2,
    spreadBps: 1,
    maxHoldBars: 60,
    regularSessionOnly: true,
  },
  SWING: {
    entryMode: "next_bar_open",
    slippageBps: 2,
    spreadBps: 1,
    maxHoldBars: 200,
    regularSessionOnly: true,
  },
  INVESTOR: {
    entryMode: "next_bar_open",
    slippageBps: 1,
    spreadBps: 1,
    maxHoldBars: null,
    regularSessionOnly: true,
  },
};

const FILTER_PROFILES: Record<EngineType, FilterProfile> = {
  DAYTRADER: {
    useTrendFilter: true,
    trendEmaPeriod: 200,
    useAtrFilter: true,
    minAtrRatio: 0.001,
    useVolumeFilter: true,
    minVolume: 1_000,
  },
  SWING: {
    useTrendFilter: true,
    trendEmaPeriod: 100,
    useAtrFilter: true,
    minAtrRatio: 0.002,
    useVolumeFilter: true,
    minVolume: 10_000,
  },
  INVESTOR: {
    useTrendFilter: true,
    trendEmaPeriod: 50,
    useAtrFilter: false,
    minAtrRatio: 0,
    useVolumeFilter: false,
    minVolume: 0,
  },
};

export interface TradeV4 {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp: number;
  direction: 'long' | 'short';
  rMultiple: number;
  pnl: number;
  win: boolean;
  exitReason?: string;
}

export interface ExecutionResult {
  trades: TradeV4[];
  equityCurve: Array<{ t: number; balance: number }>;
  filteredSignals: number;
  totalSignals: number;
  filterReasons: Record<string, number>;
  // V4.7 HTF alignment diagnostics (undefined when feature disabled)
  htfFilteredTrades?: number;
  htfFilteredLongs?: number;
  htfFilteredShorts?: number;
  htfBiasDistribution?: { bullish: number; bearish: number; neutral: number };
}

interface OpenPosition {
  entryIndex: number; // index in bars where position was opened (N+1)
  entryTime: string;
  entryPrice: number;
  sl: number;
  tp: number;
  direction: 'long' | 'short';
  size: number;
}

type ProfileKey = "daytrader" | "swing" | "investor";

function engineTypeToProfileKey(engineType: EngineType): ProfileKey {
  switch (engineType) {
    case "DAYTRADER":
      return "daytrader";
    case "SWING":
      return "swing";
    case "INVESTOR":
    default:
      return "investor";
  }
}

function ema(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n === 0) return out;
  const k = 2 / (period + 1);

  const init = Math.min(period, n);
  let sum = 0;
  for (let i = 0; i < init; i++) sum += values[i];
  let prev = sum / init;
  out[init - 1] = prev;

  for (let i = init; i < n; i++) {
    const v = values[i];
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function atr(bars: OHLCBar[], period: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (period <= 0 || n < 2) return out;

  const trs = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const high = Number(bars[i].high);
    const low = Number(bars[i].low);
    const prevClose = Number(bars[i - 1].close);
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trs[i] = Number.isFinite(tr) && tr > 0 ? tr : 0;
  }

  let sum = 0;
  let count = 0;
  for (let i = 1; i < n && count < period; i++, count++) {
    sum += trs[i];
  }
  if (count < period) return out;

  let atrPrev = sum / period;
  out[period] = atrPrev;
  for (let i = period + 1; i < n; i++) {
    atrPrev = ((atrPrev * (period - 1)) + trs[i]) / period;
    out[i] = atrPrev;
  }
  return out;
}

function applyEntrySlippage(
  rawPrice: number,
  direction: 'long' | 'short',
  profile: ExecutionProfile,
): number {
  const bps = profile.slippageBps + profile.spreadBps;
  const factor = bps / 10_000;
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return rawPrice;
  if (direction === 'long') {
    return rawPrice * (1 + factor);
  }
  return rawPrice * (1 - factor);
}

function applyExitSlippage(
  rawPrice: number,
  direction: 'long' | 'short',
  profile: ExecutionProfile,
): number {
  const bps = profile.slippageBps + profile.spreadBps;
  const factor = bps / 10_000;
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return rawPrice;
  if (direction === 'long') {
    return rawPrice * (1 - factor);
  }
  return rawPrice * (1 + factor);
}

function shouldEnterTrade(args: {
  bars: OHLCBar[];
  index: number;
  direction: 'long' | 'short';
  engineType: EngineType;
  emaTrend: number[];
  atrValues: number[];
}): { ok: boolean; reasons: string[] } {
  const { bars, index, direction, engineType, emaTrend, atrValues } = args;
  const profile = FILTER_PROFILES[engineType];
  const reasons: string[] = [];

  if (!ENABLE_V46_FILTERS) {
    return { ok: true, reasons };
  }

  const bar = bars[index];
  const close = Number(bar.close);
  const vol = Number(bar.volume ?? 0);

  if (!Number.isFinite(close) || close <= 0) {
    reasons.push("invalid_price");
  }

  if (profile.useTrendFilter) {
    const emaVal = emaTrend[index];
    if (!Number.isFinite(emaVal)) {
      reasons.push("trend_unavailable");
    } else {
      if (direction === 'long' && close < emaVal) {
        reasons.push("trend_filter_reject");
      }
      if (direction === 'short' && close > emaVal) {
        reasons.push("trend_filter_reject");
      }
    }
  }

  if (profile.useAtrFilter) {
    const atrVal = atrValues[index];
    if (!Number.isFinite(atrVal) || atrVal <= 0) {
      reasons.push("low_atr");
    } else {
      const ratio = atrVal / close;
      if (!Number.isFinite(ratio) || ratio < profile.minAtrRatio) {
        reasons.push("low_atr");
      }
    }
  }

  if (profile.useVolumeFilter) {
    if (!Number.isFinite(vol) || vol < profile.minVolume) {
      reasons.push("low_volume");
    }
  }

  // Approximate US regular session for equities if enabled: 13–20 UTC hours
  if (EXECUTION_PROFILES[engineType].regularSessionOnly) {
    const hour = new Date(bar.timestamp).getUTCHours();
    if (hour < 13 || hour > 20) {
      reasons.push("outside_regular_session");
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export async function runExecutionModel(
  engineType: EngineType,
  engineVersion: 'V3' | 'V3_5' | 'V4' | 'V4_1',
  symbol: string,
  bars: OHLCBar[],
  startingEquity: number,
  fundamentals?: FundamentalsData,
): Promise<ExecutionResult> {
  const trades: TradeV4[] = [];
  const equityCurve: Array<{ t: number; balance: number }> = [];

  let equity = startingEquity;
  let openPos: OpenPosition | null = null;

  if (!bars || bars.length < 2) {
    return {
      trades,
      equityCurve,
      filteredSignals: 0,
      totalSignals: 0,
      filterReasons: {},
    };
  }

  const execProfile = EXECUTION_PROFILES[engineType];
  const filterProfile = FILTER_PROFILES[engineType];

  const closes = bars.map((b) => Number(b.close));
  const emaTrend = filterProfile.useTrendFilter
    ? ema(closes, filterProfile.trendEmaPeriod)
    : new Array<number>(bars.length).fill(NaN);
  const atrValues = filterProfile.useAtrFilter
    ? atr(bars, 14)
    : new Array<number>(bars.length).fill(NaN);

  let totalSignals = 0;
  let filteredSignals = 0;
  const filterReasons: Record<string, number> = {};

  // -----------------------------
  // V4.7 HTF alignment precomputation
  // -----------------------------
  let htfBiasPerBar: HtfBias[] | null = null;
  let htfFilteredTrades = 0;
  let htfFilteredLongs = 0;
  let htfFilteredShorts = 0;
  const htfBiasDistribution: { bullish: number; bearish: number; neutral: number } = {
    bullish: 0,
    bearish: 0,
    neutral: 0,
  };

  if (V47_FEATURE_FLAGS.enableHtfAlignment) {
    const profileKey = engineTypeToProfileKey(engineType);
    const htfProfile = DEFAULT_V47_HTF_CONFIG[profileKey];

    try {
      const htfBars = await loadUnifiedOHLC(symbol, htfProfile.timeframe as SupportedTimeframe);
      if (htfBars && htfBars.length > 0) {
        htfBiasPerBar = new Array<HtfBias>(bars.length).fill("neutral");
        for (let i = 0; i < bars.length; i++) {
          const idx = findHtfBarIndexForEntry(bars[i].timestamp, htfBars);
          if (idx === -1) {
            htfBiasPerBar[i] = "neutral";
            continue;
          }

          // Use all HTF bars up to idx; computeHtfBias will internally
          // respect lookbackBars/minBarsForBias.
          const bias = computeHtfBias(htfBars.slice(0, idx + 1), htfProfile);
          htfBiasPerBar[i] = bias;
        }
      }
    } catch (err) {
      console.warn(
        "[v4.7 HTF] Failed to load HTF bars for",
        symbol,
        engineType,
        (err as Error)?.message ?? String(err),
      );
    }
  }

  // Record initial equity point
  const firstTs = new Date(bars[0].timestamp).getTime();
  equityCurve.push({ t: firstTs, balance: equity });

  // Iterate up to bars.length - 2 because we need bar N+1 for entry
  for (let i = 0; i < bars.length - 1; i++) {
    const barN = bars[i];
    const barNext = bars[i + 1];

    const tsNext = new Date(barNext.timestamp).getTime();

    // 1. If we have an open position, process exits on barNext intrabar
    if (openPos) {
      const exit = evaluateExitOnBar(openPos, barNext, i + 1, engineType, execProfile);
      if (exit) {
        const effectiveExitPrice = exit.exitPrice;
        const pnl = computePnl(openPos.direction, openPos.entryPrice, effectiveExitPrice, openPos.size);
        const rMultipleRaw = computeRMultiple(openPos.direction, openPos.entryPrice, effectiveExitPrice, openPos.sl);
        const rMultiple = Number.isFinite(rMultipleRaw) ? rMultipleRaw : 0;

        equity += pnl;

        trades.push({
          entryTime: openPos.entryTime,
          exitTime: exit.exitTime,
          entryPrice: openPos.entryPrice,
          exitPrice: effectiveExitPrice,
          sl: openPos.sl,
          tp: openPos.tp,
          direction: openPos.direction,
          rMultiple,
          pnl,
          win: rMultiple > 0,
          exitReason: exit.reason,
        });

        openPos = null;
      }
    }

    // Record equity after processing exits on this bar
    equityCurve.push({ t: tsNext, balance: equity });

    // 2. If no open position, evaluate potential entry at close of barN
    if (!openPos) {
      const historySlice = bars.slice(0, i + 1);
      const evalSignal = evaluateEngineSignal(engineType, engineVersion, historySlice, fundamentals);

      if (evalSignal.shouldEnter && evalSignal.direction !== 'none') {
        totalSignals++;

        const dir = evalSignal.direction;
        const filter = shouldEnterTrade({
          bars,
          index: i,
          direction: dir,
          engineType,
          emaTrend,
          atrValues,
        });

        if (!filter.ok) {
          filteredSignals++;
          for (const r of filter.reasons) {
            filterReasons[r] = (filterReasons[r] ?? 0) + 1;
          }
          continue;
        }

        // -----------------------------
        // V4.7 HTF alignment gate
        // -----------------------------
        if (V47_FEATURE_FLAGS.enableHtfAlignment && htfBiasPerBar) {
          const bias = htfBiasPerBar[i];
          if (bias === "bullish" || bias === "bearish" || bias === "neutral") {
            if (bias === "bullish") htfBiasDistribution.bullish++;
            else if (bias === "bearish") htfBiasDistribution.bearish++;
            else htfBiasDistribution.neutral++;

            const aligned = isTradeAlignedWithHtf(dir, bias);
            if (!aligned) {
              htfFilteredTrades++;
              if (dir === "long") htfFilteredLongs++;
              if (dir === "short") htfFilteredShorts++;
              continue;
            }
          }
        }

        let entryPrice = barNext.open; // raw entry at OPEN of N+1
        if (ENABLE_V46_EXECUTION) {
          entryPrice = applyEntrySlippage(entryPrice, dir, execProfile);
        }

        const sl = evalSignal.stopLoss;
        const tp = evalSignal.takeProfit;

        const size = computePositionSize(equity, entryPrice, sl);
        if (size > 0) {
          openPos = {
            entryIndex: i + 1,
            entryTime: barNext.timestamp,
            entryPrice,
            sl,
            tp,
            direction: dir,
            size,
          };
        }
      }
    }
  }

  // No forced exit at the very end; open positions remain theoretical.

  return {
    trades,
    equityCurve,
    filteredSignals,
    totalSignals,
    filterReasons,
    htfFilteredTrades,
    htfFilteredLongs,
    htfFilteredShorts,
    htfBiasDistribution,
  };
}

/**
 * Evaluate SL/TP (and optional max-hold exit) on a single bar for an open
 * position. Implements pessimistic intrabar assumptions when both SL and
 * TP could be reached.
 */
function evaluateExitOnBar(
  pos: OpenPosition,
  bar: OHLCBar,
  barIndex: number,
  engineType: EngineType,
  profile: ExecutionProfile,
): { exitPrice: number; exitTime: string; reason: string } | null {
  const low = Number(bar.low);
  const high = Number(bar.high);
  const close = Number(bar.close);

  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(close)) {
    return null;
  }

  const holdBars = barIndex - pos.entryIndex + 1;

  const slHit = pos.direction === 'long'
    ? low <= pos.sl
    : high >= pos.sl;
  const tpHit = pos.direction === 'long'
    ? high >= pos.tp
    : low <= pos.tp;

  // Pessimistic assumption: if both SL and TP are touchable in the same bar,
  // prefer the worse outcome for the strategy (i.e. SL).
  if (slHit && tpHit) {
    const raw = pos.sl;
    const exitPrice = ENABLE_V46_EXECUTION
      ? applyExitSlippage(raw, pos.direction, profile)
      : raw;
    return { exitPrice, exitTime: bar.timestamp, reason: 'sl_and_tp_hit_sl_preferred' };
  }

  if (slHit) {
    const raw = pos.sl;
    const exitPrice = ENABLE_V46_EXECUTION
      ? applyExitSlippage(raw, pos.direction, profile)
      : raw;
    return { exitPrice, exitTime: bar.timestamp, reason: 'sl_hit' };
  }

  if (tpHit) {
    const raw = pos.tp;
    const exitPrice = ENABLE_V46_EXECUTION
      ? applyExitSlippage(raw, pos.direction, profile)
      : raw;
    return { exitPrice, exitTime: bar.timestamp, reason: 'tp_hit' };
  }

  // Max-hold exit at bar close if configured
  if (ENABLE_V46_EXECUTION && profile.maxHoldBars !== null && holdBars >= profile.maxHoldBars) {
    const raw = close;
    const exitPrice = applyExitSlippage(raw, pos.direction, profile);
    return { exitPrice, exitTime: bar.timestamp, reason: 'max_hold_exit' };
  }

  return null;
}
