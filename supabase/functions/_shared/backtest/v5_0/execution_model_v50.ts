/**
 * EXECUTION MODEL V5.0
 *
 * Based on v4.9 with additional selectivity to reduce degradations
 * while keeping high trade coverage. Implements BOS/CHoCH/OB quality
 * validations and volatility/trend regime gates per spec.
 *
 * Exports: runExecutionModelV50
 */

import { OHLCBar, EngineType, FundamentalsData } from "../../signal_types.ts";
import { loadUnifiedOHLC } from "../../ohlc_loader.ts";
import { evaluateSignalV48 } from "../engine/engine_core_v48.ts";
import { evaluateExits } from "../engine/exits_engine.ts";
import { runSMCEngine } from "../engine/smc_engine.ts";
import type { MultiTimeframeInput, TFName, EngineSignalV48 } from "../engine/types.ts";

// Limit bars passed into expensive SMC/exit evaluations
const SMC_LOOKBACK_BARS = 800;

// 2.1 MIN_CONFIDENCE thresholds (global defaults)
const MIN_CONFIDENCE: Record<EngineType, number> = {
  DAYTRADER: 50,
  SWING: 52,
  INVESTOR: 55,
};

// ---- Helpers for new validations ----
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const arr = [...values].sort((a,b)=>a-b);
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
}

function wickRatio(open: number, high: number, low: number, close: number): number {
  const range = Math.max(1e-9, high - low);
  const upper = Math.max(0, high - Math.max(open, close));
  const lower = Math.max(0, Math.min(open, close) - low);
  return (upper + lower) / range;
}

function primaryTfFromEngine(e: EngineType): TFName {
  switch (e) {
    case 'DAYTRADER': return '1m';
    case 'SWING': return '4h';
    case 'INVESTOR': return '1d';
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
  const clamp = (bars: OHLCBar[]) => bars.filter(b => {
    const ms = new Date(new Date(b.timestamp).toISOString()).getTime();
    return ms >= firstTs && ms <= lastTs;
  });

  try {
    if (engineType === 'DAYTRADER') {
      const [tf5m, tf15m, tf1h, tf4h, tf1d] = await Promise.all([
        loadUnifiedOHLC(symbol, '5m'),
        loadUnifiedOHLC(symbol, '15m'),
        loadUnifiedOHLC(symbol, '1h'),
        loadUnifiedOHLC(symbol, '4h'),
        loadUnifiedOHLC(symbol, '1d'),
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

    if (engineType === 'SWING') {
      const [tf1h, tf1d] = await Promise.all([
        loadUnifiedOHLC(symbol, '1h'),
        loadUnifiedOHLC(symbol, '1d'),
      ]);
      const tf4h = primaryBars;
      return {
        tf_1m: primaryBars,
        tf_5m: primaryBars,
        tf_15m: primaryBars,
        tf_1h: clamp(tf1h.length ? tf1h : tf4h),
        tf_4h: tf4h,
        tf_1d: clamp(tf1d.length ? tf1d : tf4h),
      };
    }

    return buildSyntheticMTF(primaryBars);
  } catch {
    return buildSyntheticMTF(primaryBars);
  }
}

// Regime classifier per spec
type Regime = 'TREND'|'RANGE'|'EXPANSION'|'CONTRA';
function classifyRegime(signal: EngineSignalV48): Regime {
  const { trend, volatility } = signal.metadata as any;
  const trendStrength = Number(trend?.strength ?? 0);
  const volState = String(volatility?.state ?? 'normal');

  if (volState === 'extreme') return 'EXPANSION'; // treated as expansion/extreme (blocked later)
  if (trendStrength < 25 && volState === 'low') return 'RANGE';
  if (volState === 'high' && trendStrength >= 35) return 'EXPANSION';
  if (trendStrength >= 35 && volState !== 'extreme') return 'TREND';
  return 'CONTRA';
}

// Compute BOS displacement validity using latest BOS vs ATR
function hasValidDisplacementBOS(signal: EngineSignalV48, currentClose: number): boolean {
  const smc = signal.metadata.smc as any;
  const lastBos = smc?.bos?.length ? smc.bos[smc.bos.length - 1] : null;
  const atr = Number(signal.metadata?.volatility?.atr_value ?? 0);
  if (!lastBos || !Number.isFinite(atr) || atr <= 0) return false;
  if (lastBos.direction === 'up') return currentClose > lastBos.price + atr * 0.10;
  return currentClose < lastBos.price - atr * 0.10;
}

// Compute CHoCH validation proxy (range/ATR >= 0.5 OR volume climax)
function hasValidCHoCH(signal: EngineSignalV48, recentBars: OHLCBar[]): boolean {
  const atr = Number(signal.metadata?.volatility?.atr_value ?? 0);
  const volClimax = Boolean((signal.metadata as any)?.volume?.climax);
  if (!recentBars.length || !Number.isFinite(atr) || atr <= 0) return volClimax;
  const highs = recentBars.map(b=>b.high);
  const lows = recentBars.map(b=>b.low);
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const range = hi - lo;
  return (range / atr) >= 0.5 || volClimax;
}

// OB quality using the most recent OB in signal direction
function orderBlockQualityOk(signal: EngineSignalV48, barsWindow: OHLCBar[]): boolean {
  const smc = signal.metadata.smc as any;
  const dir = signal.direction;
  const ob = smc?.order_blocks?.slice()?.reverse()?.find((z: any) => !z.mitigated && (
    (dir === 'long' && z.direction === 'bullish') || (dir === 'short' && z.direction === 'bearish')
  ));
  if (!ob) return true; // if no OB, don't block
  // find origin bar by time
  const idx = barsWindow.findIndex(b => b.timestamp === ob.open_time);
  if (idx === -1) return true;
  const origin = barsWindow[idx];
  const medVol = median(barsWindow.map(b => Number(b.volume ?? 0)));
  const originVol = Number(origin.volume ?? 0);
  const wr = wickRatio(origin.open, origin.high, origin.low, origin.close);
  if (originVol < medVol * 0.8) return false;
  if (wr > 0.6) return false;
  return true;
}

function passesStyleGatesV50(
  engineType: EngineType,
  signal: EngineSignalV48,
  ctx: {
    regime: Regime;
    has_valid_displacement_bos: boolean;
    choch_valid: boolean;
    ob_quality_ok: boolean;
  }
): { ok: boolean; reasonKey?: string } {
  const { smc, trend, volume, liquidity, volatility } = signal.metadata as any;
  const { regime } = ctx;

  if (engineType === 'DAYTRADER') {
    if (signal.confidence < MIN_CONFIDENCE.DAYTRADER)
      return { ok: false, reasonKey: 'conf_low_day_v50' };

    if (smc.smc_strength < 50)
      return { ok: false, reasonKey: 'smc_weak_day_v50' };

    if (trend.strength < 30)
      return { ok: false, reasonKey: 'trend_weak_day_v50' };

    if (regime === 'RANGE' && trend.strength < 25)
      return { ok: false, reasonKey: 'range_block_day_v50' };

    if ((volume.strength ?? volume.score ?? 0) < 25)
      return { ok: false, reasonKey: 'vol_weak_day_v50' };

    if (volatility.state === 'extreme')
      return { ok: false, reasonKey: 'vol_extreme_day_v50' };

    if (volatility.state === 'high' && smc.smc_strength < 55)
      return { ok: false, reasonKey: 'vol_high_weak_smc_day_v50' };

    const liquidityEdge = liquidity.sweep !== null || liquidity.eq_highs || liquidity.eq_lows;
    if (liquidityEdge && smc.smc_strength >= 55)
      return { ok: true, reasonKey: 'liq_override_day_v50' };

    return { ok: true, reasonKey: 'pass_day_v50' };
  }

  if (engineType === 'SWING') {
    if (signal.confidence < MIN_CONFIDENCE.SWING)
      return { ok: false, reasonKey: 'conf_low_swing_v50' };

    if (smc.smc_strength < 50)
      return { ok: false, reasonKey: 'smc_weak_swing_v50' };

    if (!ctx.has_valid_displacement_bos)
      return { ok: false, reasonKey: 'bos_no_displacement_swing_v50' };

    if (!ctx.ob_quality_ok)
      return { ok: false, reasonKey: 'ob_quality_fail_swing_v50' };

    if (regime === 'RANGE')
      return { ok: false, reasonKey: 'range_block_swing_v50' };

    if (trend.strength < 35)
      return { ok: false, reasonKey: 'trend_weak_swing_v50' };

    if (volatility.state === 'extreme')
      return { ok: false, reasonKey: 'vol_extreme_swing_v50' };

    const wr = Number((signal as any).metadata?.candle?.wick_ratio ?? 0);
    if (wr > 0.6 && !signal.metadata.liquidity.sweep)
      return { ok: false, reasonKey: 'wicky_bad_breakout_swing_v50' };

    return { ok: true, reasonKey: 'pass_swing_v50' };
  }

  // INVESTOR simple gate
  if (engineType === 'INVESTOR') {
    if (signal.confidence < MIN_CONFIDENCE.INVESTOR)
      return { ok: false, reasonKey: 'conf_low_investor_v50' };
    return { ok: true, reasonKey: 'pass_investor_v50' };
  }

  return { ok: true };
}

export interface TradeV5 {
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

export interface ExecutionResultV5 {
  trades: TradeV5[];
  equityCurve: Array<{ t: number; balance: number }>;
  filteredSignals: number;
  totalSignals: number;
  filterReasons: Record<string, number>;
  lastMetadata?: {
    engine_version: 'v5.0';
    bos_displacement: boolean;
    orderblock_quality: boolean;
    trend_regime: Regime;
    volatility_state: string;
  };
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

const EXECUTION_PROFILES: Record<EngineType, { slippageBps: number; spreadBps: number; maxHoldBars: number | null; }> = {
  DAYTRADER: { slippageBps: 2, spreadBps: 1, maxHoldBars: 60 },
  SWING: { slippageBps: 2, spreadBps: 1, maxHoldBars: 200 },
  INVESTOR: { slippageBps: 1, spreadBps: 1, maxHoldBars: null },
};

function applyEntrySlippage(rawPrice: number, direction: 'long'|'short', profile: { slippageBps: number; spreadBps: number; }): number {
  const bps = profile.slippageBps + profile.spreadBps;
  const factor = bps / 10_000;
  return direction === 'long' ? rawPrice * (1 + factor) : rawPrice * (1 - factor);
}

function applyExitSlippage(rawPrice: number, direction: 'long'|'short', profile: { slippageBps: number; spreadBps: number; }): number {
  const bps = profile.slippageBps + profile.spreadBps;
  const factor = bps / 10_000;
  return direction === 'long' ? rawPrice * (1 - factor) : rawPrice * (1 + factor);
}

function computePositionSize(equity: number, entryPrice: number, sl: number, engineType: EngineType): number {
  const dist = Math.abs(entryPrice - sl);
  if (dist <= 0 || equity <= 0) return 0;
  const riskPct = engineType === 'DAYTRADER' ? 0.0025 : engineType === 'SWING' ? 0.0075 : 0.01;
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

export async function runExecutionModelV50(
  engineType: EngineType,
  symbol: string,
  bars: OHLCBar[],
  startingEquity: number,
  _fundamentals?: FundamentalsData,
): Promise<ExecutionResultV5> {
  const trades: TradeV5[] = [];
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
  let lastMetadata: ExecutionResultV5['lastMetadata'] | undefined;

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
        entryOB: openPos.entryOB,
      });

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

    // Evaluate entries when flat
    if (!openPos) {
      const signal = evaluateSignalV48({ symbol, engineType, primaryTf, mtf, currentIndexPrimary: i });
      if (signal.direction !== 'none' && signal.sl_price && signal.tp_price) {
        if (signal.confidence < minConfidence) {
          filteredSignals++;
          const key = `confidence_below_${minConfidence}_v50`;
          filterReasons[key] = (filterReasons[key] ?? 0) + 1;
          continue;
        }

        // Count sufficiently confident signals
        totalSignals++;

        // Build v5.0 context features (displacement BOS, CHoCH, OB quality, regime)
        const recentBars = bars.slice(Math.max(0, i - 20), i + 1);
        const regime = classifyRegime(signal as any);
        const bosDisp = hasValidDisplacementBOS(signal as any, barCurr.close);
        const chochValid = hasValidCHoCH(signal as any, recentBars);
        const obOk = orderBlockQualityOk(signal as any, recentBars);

        // Style-specific gates
        const gate = passesStyleGatesV50(engineType, signal as any, {
          regime,
          has_valid_displacement_bos: bosDisp,
          choch_valid: chochValid,
          ob_quality_ok: obOk,
        });
        if (!gate.ok) {
          filteredSignals++;
          if (gate.reasonKey) filterReasons[gate.reasonKey] = (filterReasons[gate.reasonKey] ?? 0) + 1;
          continue;
        }

        const entryPrice = applyEntrySlippage(barNext.open, signal.direction, profile);
        const sl = signal.sl_price;
        const tp = signal.tp_price;
        const size = computePositionSize(equity, entryPrice, sl, engineType);

        if (size > 0) {
          const smcMeta = signal.metadata.smc as any;
          const entryOB = smcMeta.order_blocks.find((z: any) =>
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

        // Save last metadata snapshot for diagnostics
        lastMetadata = {
          engine_version: 'v5.0',
          bos_displacement: bosDisp,
          orderblock_quality: obOk,
          trend_regime: regime,
          volatility_state: String((signal.metadata as any)?.volatility?.state ?? 'unknown'),
        };
      } else if (signal.direction !== 'none') {
        filteredSignals++;
        const key = 'invalid_sl_tp_or_confidence_v50';
        filterReasons[key] = (filterReasons[key] ?? 0) + 1;
      }
    }
  }

  return { trades, equityCurve, filteredSignals, totalSignals, filterReasons, lastMetadata };
}