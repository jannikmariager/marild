/**
 * EXECUTION MODEL V4.9
 *
 * Tuned-filter variant of the modular v4.8 engine.
 * - Softer DAYTRADER and SWING gates to increase trade count
 * - INVESTOR filters kept simple
 *
 * Isolated from v4.6/v4.7/v4.8 to preserve existing behavior.
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
  DAYTRADER: 50, // v4.8 was 55
  SWING: 52,     // v4.8 was 58
  INVESTOR: 55,  // unchanged – investor looked OK
};

// Additional hard gates per style using module metadata (v4.9 tuned).
function passesStyleGatesV49(
  engineType: EngineType,
  signal: EngineSignalV48,
): { ok: boolean; reasonKey?: string } {
  const { smc, trend, volume, liquidity, volatility } = signal.metadata;

  if (engineType === "DAYTRADER") {
    // 1) Minimum SMC quality – slightly softer than v4.8
    if (smc.smc_strength < 50) {
      return { ok: false, reasonKey: "smc_weak_day_v49" };
    }

    // 2) Trend – allow mild chop, only reject truly flat or very weak trends
    if (trend.direction === "sideways" && trend.strength < 35) {
      return { ok: false, reasonKey: "trend_too_sideways_day_v49" };
    }
    if (trend.strength < 30) {
      return { ok: false, reasonKey: "trend_very_weak_day_v49" };
    }

    // 3) Volume – softer threshold, but still require some participation
    if (volume.strength < 25) {
      return { ok: false, reasonKey: "volume_very_weak_day_v49" };
    }

    // 4) Volatility – only reject *extreme* spikes; allow high vol with good SMC
    if (volatility.state === "extreme") {
      return { ok: false, reasonKey: "vol_extreme_day_v49" };
    }
    if (volatility.state === "high" && smc.smc_strength < 55) {
      return { ok: false, reasonKey: "vol_high_weak_smc_day_v49" };
    }

    // 5) Liquidity/structure override for strong SMC setups
    const hasStrongLiquidityEdge =
      liquidity.sweep !== null || liquidity.eq_highs || liquidity.eq_lows;

    if (
      hasStrongLiquidityEdge &&
      smc.smc_strength >= 55 &&
      trend.strength >= 25 &&
      volume.strength >= 20
    ) {
      return { ok: true, reasonKey: "liquidity_override_day_v49" };
    }

    return { ok: true, reasonKey: "pass_day_v49" };
  }

  if (engineType === "SWING") {
    // 1) SMC – slightly softer
    if (smc.smc_strength < 50) {
      return { ok: false, reasonKey: "smc_weak_swing_v49" };
    }

    // 2) Trend – still require decent trend, but not as extreme
    if (trend.direction === "sideways" && trend.strength < 40) {
      return { ok: false, reasonKey: "trend_too_sideways_swing_v49" };
    }
    if (trend.strength < 35) {
      return { ok: false, reasonKey: "trend_very_weak_swing_v49" };
    }

    // 3) Volatility – reject only extreme conditions; allow typical high vol
    if (volatility.state === "extreme") {
      return { ok: false, reasonKey: "vol_extreme_swing_v49" };
    }

    return { ok: true, reasonKey: "pass_swing_v49" };
  }

  // INVESTOR: no extra hard gates beyond confidence for now (see call site).
  return { ok: true, reasonKey: "pass_investor_v49" };
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
  entryEquity: number; // Capture equity at entry for R-multiple calculation
  entryOB?: { top: number; bottom: number };
}

type ExecutionProfile = {
  slippageBps: number;
  spreadBps: number;
  maxHoldBars: number | null;
};

const EXECUTION_PROFILES: Record<EngineType, ExecutionProfile> = {
  DAYTRADER: { slippageBps: 2, spreadBps: 1, maxHoldBars: 60 },
  SWING: { slippageBps: 2, spreadBps: 1, maxHoldBars: null }, // No max hold - let TP/SL decide
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
  if (equity <= 0 || entryPrice <= 0) return 0;
  
  // INVESTOR and SWING use portfolio allocation sizing (more realistic for longer holds)
  if (engineType === "INVESTOR") {
    // INVESTOR: allocate 15% of portfolio per position (max ~6-7 concurrent positions)
    const allocation = equity * 0.15;
    return allocation / entryPrice;
  }
  
  if (engineType === "SWING") {
    // SWING: allocate 7.5% of portfolio per position (max ~13 concurrent positions)
    const allocation = equity * 0.075;
    return allocation / entryPrice;
  }
  
  // DAYTRADER: use risk-based sizing with tight stops (0.5% risk per trade)
  const dist = Math.abs(entryPrice - sl);
  if (dist <= 0) return 0;
  return (equity * 0.005) / dist;
}

function computeRMultiple(
  dir: 'long'|'short',
  entry: number,
  exit: number,
  sl: number,
  pnl: number,
  entryEquity: number,
  engineType: EngineType
): number {
  // INVESTOR uses allocation-based R (buy-and-hold with trailing stops)
  if (engineType === "INVESTOR") {
    if (entryEquity === 0) return 0;
    const portfolioPct = pnl / entryEquity;
    const allocationPct = 0.15;
    return portfolioPct / allocationPct;
  }
  
  // SWING and DAYTRADER: traditional stop-distance-based R-multiple
  // This makes sense because we have defined TP/SL levels from technical analysis
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
      const t = new Date(b.timestamp).toISOString();
      const ms = new Date(t).getTime();
      return ms >= firstTs && ms <= lastTs;
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

export async function runExecutionModelV49(
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
      // v4.9 is for SWING and INVESTOR only - use simple TP/SL exits, no dynamic exits
      // (DAYTRADER uses v7.4 which has its own exit logic)
      
      const low = barNext.low, high = barNext.high, close = barNext.close;
      
      // INVESTOR: Buy-and-hold with trailing stop (no TP target)
      if (engineType === 'INVESTOR') {
        // Calculate current profit in R
        const initialRisk = Math.abs(openPos.entryPrice - openPos.sl);
        const currentProfit = openPos.direction === 'long' 
          ? (close - openPos.entryPrice) 
          : (openPos.entryPrice - close);
        const profitInR = initialRisk > 0 ? currentProfit / initialRisk : 0;
        
        // Move SL to breakeven when profit >= 1R
        if (profitInR >= 1.0 && openPos.sl !== openPos.entryPrice) {
          openPos.sl = openPos.entryPrice;
        }
        
        // Trail SL: keep it at 85% of highest profit (15% trailing stop from peak)
        if (profitInR > 1.0) {
          const trailDistance = initialRisk * 0.15; // 15% of initial risk as trail
          const newSL = openPos.direction === 'long'
            ? Math.max(openPos.sl, close - trailDistance)
            : Math.min(openPos.sl, close + trailDistance);
          openPos.sl = newSL;
        }
        
        // Check SL hit (no TP for investor)
        const slHit = openPos.direction === 'long' ? low <= openPos.sl : high >= openPos.sl;
        
        let exitPrice: number | null = null;
        let exitReason = '';
        
        if (slHit) {
          exitPrice = applyExitSlippage(openPos.sl, openPos.direction, profile);
          exitReason = profitInR >= 1.0 ? 'trailing_stop_hit' : 'sl_hit';
        }
        
        if (exitPrice !== null) {
          const pnl = computePnl(openPos.direction, openPos.entryPrice, exitPrice, openPos.size);
          const rMult = computeRMultiple(
            openPos.direction,
            openPos.entryPrice,
            exitPrice,
            openPos.sl,
            pnl,
            openPos.entryEquity,
            engineType
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
      } else {
        // SWING: Use TP/SL exits
        const slHit = openPos.direction === 'long' ? low <= openPos.sl : high >= openPos.sl;
        const tpHit = openPos.direction === 'long' ? high >= openPos.tp : low <= openPos.tp;

        let exitPrice: number | null = null;
        let exitReason = '';

        if (slHit && tpHit) {
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

        if (exitPrice !== null) {
          const pnl = computePnl(openPos.direction, openPos.entryPrice, exitPrice, openPos.size);
          const rMult = computeRMultiple(
            openPos.direction,
            openPos.entryPrice,
            exitPrice,
            openPos.sl,
            pnl,
            openPos.entryEquity,
            engineType
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

      if (signal.direction !== 'none' && signal.sl_price && signal.tp_price) {
        // Global confidence gate first
        if (signal.confidence < minConfidence) {
          filteredSignals++;
          const key = `confidence_below_${minConfidence}_v49`;
          filterReasons[key] = (filterReasons[key] ?? 0) + 1;
          continue;
        }

        // First count all sufficiently confident signals
        totalSignals++;

        // Then apply style-specific hard gates to keep only high-quality setups.
        const gate = passesStyleGatesV49(engineType, signal as EngineSignalV48);
        if (!gate.ok) {
          filteredSignals++;
          if (gate.reasonKey) {
            filterReasons[gate.reasonKey] = (filterReasons[gate.reasonKey] ?? 0) + 1;
          }
          continue;
        }

        // INVESTOR extra check: keep explicit confidence gate semantics
        if (engineType === 'INVESTOR' && signal.confidence < MIN_CONFIDENCE.INVESTOR) {
          filteredSignals++;
          filterReasons['low_confidence_investor_v49'] = (filterReasons['low_confidence_investor_v49'] ?? 0) + 1;
          continue;
        }

        const entryPrice = applyEntrySlippage(barNext.open, signal.direction, profile);
        const sl = signal.sl_price;
        const tp = signal.tp_price;
        const size = computePositionSize(equity, entryPrice, sl, engineType);

        if (size > 0) {
          // Find entry OB for exits engine reference
          const smcMeta = signal.metadata.smc;
          const entryOB = smcMeta.order_blocks.find(z =>
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
            entryEquity: equity, // Capture equity at entry for R-multiple calc
            entryOB: entryOB ? { top: entryOB.top, bottom: entryOB.bottom } : undefined,
          };
        }
      } else if (signal.direction !== 'none') {
        filteredSignals++;
        const key = `invalid_sl_tp_or_confidence_v49`;
        filterReasons[key] = (filterReasons[key] ?? 0) + 1;
      }
    }
  }

  return { trades, equityCurve, filteredSignals, totalSignals, filterReasons };
}
