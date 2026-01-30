// supabase/functions/_shared/backtest/engine/types.ts
// Shared interfaces for v4.8 modular engine

import type { OHLCBar, EngineType } from "../../signal_types.ts";

export type TFName = '1m'|'5m'|'15m'|'1h'|'4h'|'1d';

export interface OHLCV extends OHLCBar {}

export interface MultiTimeframeInput {
  tf_1m: OHLCV[];
  tf_5m: OHLCV[];
  tf_15m: OHLCV[];
  tf_1h: OHLCV[];
  tf_4h: OHLCV[];
  tf_1d: OHLCV[];
}

export type StructureShift = 'bos_up'|'bos_down'|'choch_up'|'choch_down'|null;

export interface OrderBlockZone {
  direction: 'bullish'|'bearish';
  top: number;   // price
  bottom: number;// price
  open_time: string; // ISO
  close_time: string; // ISO
  mitigated: boolean;
  mitigation_time?: string;
  origin: 'bos'|'choch'|'swing';
}

export interface FVGZone {
  direction: 'bullish'|'bearish';
  start_index: number; // index in primary TF
  end_index: number;
  gap_top: number;
  gap_bottom: number;
  size: number; // absolute price gap
}

export interface LiquidityEvent {
  type: 'eq_highs'|'eq_lows'|'sweep_buy_side'|'sweep_sell_side';
  price: number;
  time: string; // ISO
}

export interface SMCResult {
  bos: Array<{ time: string; price: number; direction: 'up'|'down' }>;
  choch: Array<{ time: string; price: number; direction: 'up'|'down' }>;
  order_blocks: OrderBlockZone[];
  fvg: FVGZone[];
  liquidity_events: LiquidityEvent[];
  premium_discount_zone: 'premium'|'discount'|'neutral';
  smc_strength: number; // 0-100
}

export interface TrendResult {
  direction: 'up'|'down'|'sideways';
  strength: number; // 0-100
  exhaustion: boolean;
}

export interface VolumeResult {
  expansion: boolean;
  divergence: boolean;
  climax: boolean;
  score: number; // 0-100
}

export interface LiquidityResult {
  sweep: 'buy_side'|'sell_side'|null;
  eq_highs: boolean;
  eq_lows: boolean;
  score: number; // 0-100
}

export interface VolatilityResult {
  atr_value: number; // ATR(14) latest
  state: 'low'|'normal'|'high';
  score: number; // 0-100 (stability)
}

export interface RiskLevels {
  sl_price: number;
  tp_price: number;
  rr_ratio: number; // TP distance / SL distance
}

export interface ExitSignal {
  should_exit: boolean;
  reason: 'trailing_sl'|'break_even'|'opposite_choch'|'volume_collapse'|'ob_mitigated'|null;
  new_sl?: number;
  new_tp?: number;
}

export interface EngineSignalV48 {
  version: 'v4.8';
  direction: 'long'|'short'|'none';
  tp_price: number|null;
  sl_price: number|null;
  confidence: number; // 0-100
  reason: string;
  metadata: {
    smc: SMCResult;
    trend: TrendResult;
    volume: VolumeResult;
    liquidity: LiquidityResult;
    volatility: VolatilityResult;
    exits?: Record<string, unknown>;
    engine_components: {
      smc: true;
      liquidity: true;
      volume_v2: true;
      trend_v2: true;
      exits_v2: true;
      risk_v2: true;
      shorting: true;
    }
  };
}

export interface EngineCoreParams {
  symbol: string;
  engineType: EngineType;
  primaryTf: TFName;
  mtf: MultiTimeframeInput;
  currentIndexPrimary: number; // index of last closed candle in primary TF
}
