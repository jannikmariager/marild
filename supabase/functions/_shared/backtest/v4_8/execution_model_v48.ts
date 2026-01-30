/**
 * EXECUTION MODEL V4.8
 *
 * Uses the modular v4.8 engine (engine_core_v48) for signal generation
 * and integrates exits_engine for dynamic SL/TP management.
 *
 * Isolated from v4.6/v4.7 execution models to preserve existing behavior.
 */

import { OHLCBar, EngineType, FundamentalsData } from "../../signal_types.ts";
import { loadUnifiedOHLC } from "../../ohlc_loader.ts";
import { evaluateSignalV48 } from "../engine/engine_core_v48.ts";
import { evaluateExits } from "../engine/exits_engine.ts";
import { runSMCEngine } from "../engine/smc_engine.ts";
import type { MultiTimeframeInput, TFName, EngineSignalV48 } from "../engine/types.ts";

// Limit how many bars are passed into expensive SMC/exit evaluations
// to avoid O(N^2) behavior on long intraday histories.
const SMC_LOOKBACK_BARS = 800; // must be >= swing structure depth

// Style-specific minimum confidence thresholds for executing trades.
// These sit above the base 40pt SMC threshold used inside the
// confluence engine so that only the strongest setups for each
// style are actually traded.
const MIN_CONFIDENCE: Record<EngineType, number> = {
  DAYTRADER: 55,  // Balanced to filter ~60-70% of signals while allowing quality trades
  SWING: 58,
  INVESTOR: 55,
};

// Additional hard gates per style using module metadata.
function passesStyleGates(
  engineType: EngineType,
  signal: EngineSignalV48,
): { ok: boolean; reasonKey?: string } {
  const { smc, trend, volume, liquidity, volatility } = signal.metadata;

  if (engineType === "DAYTRADER") {
    // Balanced gates to filter low-quality setups while allowing enough trades.
    if (smc.smc_strength < 55) return { ok: false, reasonKey: "smc_weak_day" };
    if (trend.direction === "sideways") return { ok: false, reasonKey: "trend_sideways_day" };
    if (trend.strength < 40) return { ok: false, reasonKey: "trend_strength_weak_day" };
    // Require volume confirmation but not too strict.
    if (volume.strength < 35) return { ok: false, reasonKey: "volume_weak_day" };
    // Filter out high volatility with weak SMC.
    if (volatility.state === "high" && smc.smc_strength < 65) return { ok: false, reasonKey: "vol_high_weak_smc_day" };
    return { ok: true };
  }

  if (engineType === "SWING") {
    if (smc.smc_strength < 55) return { ok: false, reasonKey: "smc_weak_swing" };
    if (trend.direction === "sideways" || trend.strength < 50) return { ok: false, reasonKey: "trend_weak_swing" };
    if (volatility.state === "high") return { ok: false, reasonKey: "vol_too_high_swing" };
    return { ok: true };
  }

  // INVESTOR: no extra hard gates beyond confidence for now.
  return { ok: true };
}

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
}

interface OpenPosition {
  entryIndex: number;
  entryTime: string;
  entryPrice: number;
  sl: number;
  tp: number;
  direction: 'long' | 'short';
  size: number;
  entryOB?: { top: number; bottom: number };
}

type ExecutionProfile = {
  slippageBps: number;
  spreadBps: number;
  maxHoldBars: number | null;
};

const EXECUTION_PROFILES: Record<EngineType, ExecutionProfile> = {
  DAYTRADER: { slippageBps: 2, spreadBps: 1, maxHoldBars: 60 },
  SWING: { slippageBps: 2, spreadBps: 1, maxHoldBars: 200 },
  INVESTOR: { slippageBps: 1, spreadBps: 1, maxHoldBars: null },
};

function applyEntrySlippage(rawPrice: number, direction: 'long'|'short', profile: ExecutionProfile): number {
  const bps = profile.slippageBps + profile.spreadBps;
  const factor = bps / 10_000;
  if (direction === 'long') return rawPrice * (1 + factor);
  return rawPrice * (1 - factor);
}

function applyExitSlippage(rawPrice: number, direction: 'long'|'short', profile: ExecutionProfile): number {
  const bps = profile.slippageBps + profile.spreadBps;
  const factor = bps / 10_000;
  if (direction === 'long') return rawPrice * (1 - factor);
  return rawPrice * (1 + factor);
}

function computePositionSize(equity: number, entryPrice: number, sl: number, engineType: EngineType): number {
  const dist = Math.abs(entryPrice - sl);
  if (dist <= 0 || equity <= 0) return 0;
  
  // Style-specific risk per trade to manage drawdown on high-frequency strategies.
  const riskPct = engineType === "DAYTRADER" ? 0.0025 : engineType === "SWING" ? 0.0075 : 0.01;
  return (equity * riskPct) / dist;
}

function computeRMultiple(dir: 'long'|'short', entry: number, exit: number, sl: number): number {
  const denom = dir === 'long' ? (entry - sl) : (sl - entry);
  if (denom === 0) return 0;
  const num = dir === 'long' ? (exit - entry) : (entry - exit);
  return num / denom;
}

function computePnl(dir: 'long'|'short', entry: number, exit: number, size: number): number {
  const delta = dir === 'long' ? (exit - entry) : (entry - exit);
  return delta * size;
}

function primaryTfFromEngine(e: EngineType): TFName {
  switch (e) {
    case 'DAYTRADER': return '1m';  // 1m/3m/5m priority
    case 'SWING': return '4h';       // 4h for swing (matches v4.6/v4.7)
    case 'INVESTOR': return '1d';    // 1d for investing
  }
}

// Build synthetic MTF from primary bars (phase 1: same bars for all TF)
function buildSyntheticMTF(bars: OHLCBar[]): MultiTimeframeInput {
  return {
    tf_1m: bars,
    tf_5m: bars,
    tf_15m: bars,
    tf_1h: bars,
    tf_4h: bars,
    tf_1d: bars,
  };
}

// Build real multi-timeframe input using Hyperdisk / Massive+Yahoo data when available.
// Falls back to synthetic if any load fails.
async function buildMultiTimeframeInput(
  engineType: EngineType,
  symbol: string,
  primaryBars: OHLCBar[],
): Promise<MultiTimeframeInput> {
  if (!primaryBars.length) return buildSyntheticMTF(primaryBars);

  const firstTs = new Date(primaryBars[0].timestamp).getTime();
  const lastTs = new Date(primaryBars[primaryBars.length - 1].timestamp).getTime();

  const clampToPrimaryWindow = (bars: OHLCBar[]): OHLCBar[] => {
    if (!bars.length) return bars;
    return bars.filter((b) => {
      const t = new Date(b.timestamp).getTime();
      return t >= firstTs && t <= lastTs;
    });
  };

  try {
    if (engineType === "DAYTRADER") {
      // Primary: 1m (from loader); higher TFs loaded from disk/bucket.
      const [tf5m, tf15m, tf1h, tf4h, tf1d] = await Promise.all([
        loadUnifiedOHLC(symbol, "5m"),
        loadUnifiedOHLC(symbol, "15m"),
        loadUnifiedOHLC(symbol, "1h"),
        loadUnifiedOHLC(symbol, "4h"),
        loadUnifiedOHLC(symbol, "1d"),
      ]);

      return {
        tf_1m: primaryBars,
        tf_5m: clampToPrimaryWindow(tf5m.length ? tf5m : primaryBars),
        tf_15m: clampToPrimaryWindow(tf15m.length ? tf15m : primaryBars),
        tf_1h: clampToPrimaryWindow(tf1h.length ? tf1h : primaryBars),
        tf_4h: clampToPrimaryWindow(tf4h.length ? tf4h : primaryBars),
        tf_1d: clampToPrimaryWindow(tf1d.length ? tf1d : primaryBars),
      };
    }

    if (engineType === "SWING") {
      // Primary: 4h; also load 1h + 1d for trend context.
      const [tf1h, tf1d] = await Promise.all([
        loadUnifiedOHLC(symbol, "1h"),
        loadUnifiedOHLC(symbol, "1d"),
      ]);

      const tf4h = primaryBars;
      const tf1hTrim = clampToPrimaryWindow(tf1h.length ? tf1h : tf4h);
      const tf1dTrim = clampToPrimaryWindow(tf1d.length ? tf1d : tf4h);

      return {
        // Lower TF slots are not used by swing modules today; reuse primary for type safety.
        tf_1m: primaryBars,
        tf_5m: primaryBars,
        tf_15m: primaryBars,
        tf_1h: tf1hTrim,
        tf_4h: tf4h,
        tf_1d: tf1dTrim,
      };
    }

    // INVESTOR: currently uses daily as primary; multi-TF not wired yet – use synthetic.
    return buildSyntheticMTF(primaryBars);
  } catch (_err) {
    // On any loader failure, fall back to synthetic behavior so engine still runs.
    return buildSyntheticMTF(primaryBars);
  }
}

export async function runExecutionModelV48(
  engineType: EngineType,
  symbol: string,
  bars: OHLCBar[],
  startingEquity: number,
  _fundamentals?: FundamentalsData,
): Promise<ExecutionResult> {
  const trades: TradeV4[] = [];
  const equityCurve: Array<{ t: number; balance: number }> = [];
  let equity = startingEquity;
  let openPos: OpenPosition | null = null;

  if (!bars || bars.length < 2) {
    return { trades, equityCurve, filteredSignals: 0, totalSignals: 0, filterReasons: {} };
  }

  const profile = EXECUTION_PROFILES[engineType];
  const primaryTf = primaryTfFromEngine(engineType);
  const mtf = await buildMultiTimeframeInput(engineType, symbol, bars);
  const minConfidence = MIN_CONFIDENCE[engineType];

  let totalSignals = 0;
  let filteredSignals = 0;
  const filterReasons: Record<string, number> = {};

  const firstTs = new Date(bars[0].timestamp).getTime();
  equityCurve.push({ t: firstTs, balance: equity });

  for (let i = 0; i < bars.length - 1; i++) {
    const barNext = bars[i + 1];
    const tsNext = new Date(barNext.timestamp).getTime();

    // 1. If open position, evaluate exits
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
        entryOB: openPos.entryOB,
      });

      // Check SL/TP hit on barNext
      const low = barNext.low, high = barNext.high, close = barNext.close;
      const slHit = openPos.direction === 'long' ? low <= openPos.sl : high >= openPos.sl;
      const tpHit = openPos.direction === 'long' ? high >= openPos.tp : low <= openPos.tp;

      let exitPrice: number | null = null;
      let exitReason = '';

      if (exitSignal.should_exit) {
        exitPrice = applyExitSlippage(close, openPos.direction, profile);
        exitReason = exitSignal.reason ?? 'dynamic_exit';
      } else if (slHit && tpHit) {
        exitPrice = applyExitSlippage(openPos.sl, openPos.direction, profile);
        exitReason = 'sl_and_tp_hit_sl_preferred';
      } else if (slHit) {
        exitPrice = applyExitSlippage(openPos.sl, openPos.direction, profile);
        exitReason = 'sl_hit';
      } else if (tpHit) {
        exitPrice = applyExitSlippage(openPos.tp, openPos.direction, profile);
        exitReason = 'tp_hit';
      } else if (profile.maxHoldBars !== null && (i + 1 - openPos.entryIndex) >= profile.maxHoldBars) {
        exitPrice = applyExitSlippage(close, openPos.direction, profile);
        exitReason = 'max_hold_exit';
      }

      // Update SL if exit engine adjusted it
      if (exitSignal.new_sl !== undefined && !exitPrice) {
        openPos.sl = exitSignal.new_sl;
      }

      if (exitPrice !== null) {
        const pnl = computePnl(openPos.direction, openPos.entryPrice, exitPrice, openPos.size);
        const rMult = computeRMultiple(openPos.direction, openPos.entryPrice, exitPrice, openPos.sl);
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

    // 2. If no open position, evaluate entry
    if (!openPos) {
      const signal = evaluateSignalV48({
        symbol,
        engineType,
        primaryTf,
        mtf,
        currentIndexPrimary: i,
      });

      if (signal.direction !== 'none' && signal.confidence >= minConfidence && signal.sl_price && signal.tp_price) {
        // First count all sufficiently confident signals
        totalSignals++;

        // Then apply style-specific hard gates to keep only high-quality setups.
        const gate = passesStyleGates(engineType, signal as EngineSignalV48);
        if (!gate.ok) {
          filteredSignals++;
          if (gate.reasonKey) {
            filterReasons[gate.reasonKey] = (filterReasons[gate.reasonKey] ?? 0) + 1;
          }
          continue;
        }

        const entryPrice = applyEntrySlippage(barNext.open, signal.direction, profile);
        const sl = signal.sl_price;
        const tp = signal.tp_price;
        const size = computePositionSize(equity, entryPrice, sl, engineType);

        if (size > 0) {
          // Find entry OB for exits engine reference
          const smc = signal.metadata.smc;
          const entryOB = smc.order_blocks.find(z =>
            z.direction === (signal.direction === 'long' ? 'bullish' : 'bearish') && !z.mitigated
          );

          openPos = {
            entryIndex: i + 1,
            entryTime: barNext.timestamp,
            entryPrice,
            sl,
            tp,
            direction: signal.direction,
            size,
            entryOB: entryOB ? { top: entryOB.top, bottom: entryOB.bottom } : undefined,
          };
        }
      } else if (signal.direction !== 'none') {
        filteredSignals++;
        const key = `confidence_below_${minConfidence}`;
        filterReasons[key] = (filterReasons[key] ?? 0) + 1;
      }
    }
  }

  return { trades, equityCurve, filteredSignals, totalSignals, filterReasons };
}
