import type { OHLCBar, EngineType } from "../signal_types.ts";
import { createEmptyStructureState, type StructureStateV47 } from "./engine/structure_state_v47.ts";
import { detectBOS, type BOSSignal } from "./structure/bos_detector_v47.ts";
import { detectOrderBlocks, markMitigation, type OrderBlock } from "./structure/order_blocks_v47.ts";
import { computeMomentumStates, type MomentumStateV47 } from "./indicators/momentum_v47.ts";
import { evaluateEntriesV47 } from "./engine/entry_evaluator_v47.ts";

export interface EngineV47Overlays {
  bosMarkers: BOSSignal[];
  orderBlocks: OrderBlock[];
  htfBiasByBar: ("bullish" | "bearish" | "neutral")[];
  entrySignals: V47Signal[];
  momentumStates: MomentumStateV47[];
}

export interface V47Signal {
  index: number;
  direction: "long" | "short";
  ob: OrderBlock;
  bos: BOSSignal;
  confidence: number;
}

export interface EngineV47Result {
  symbol: string;
  timeframe: string;
  engineType: EngineType;
  bars: OHLCBar[];
  structure: StructureStateV47;
  bos: BOSSignal[];
  orderBlocks: OrderBlock[];
  momentum: MomentumStateV47[];
  signals: V47Signal[];
  warnings: string[];
  overlays: EngineV47Overlays;
}

export interface EngineV47Params {
  symbol: string;
  timeframe: string;
  engineType: EngineType;
  bars: OHLCBar[];
  htfBiasOverall: "bullish" | "bearish" | "neutral";
}

export function runEngineV47(params: EngineV47Params): EngineV47Result {
  const { symbol, timeframe, engineType, bars, htfBiasOverall } = params;
  const warnings: string[] = [];

  if (!bars || bars.length < 10) {
    warnings.push("INSUFFICIENT_DATA_V47");
  }

  // 1) Initialize structure state with HTF bias
  const structure = createEmptyStructureState(htfBiasOverall);

  // 2) Run BOS detector (LTF structure)
  const bosList = detectBOS(bars, structure);

  // 3) Detect and mitigate Order Blocks
  const orderBlocks = detectOrderBlocks(bosList, bars);
  markMitigation(orderBlocks, bars);
  structure.activeOBs = orderBlocks;

  // 4) Momentum signals
  const momentum = computeMomentumStates(bars);

  // 5) Entry evaluation
  const signals = evaluateEntriesV47(bars, structure, momentum);

  // 6) Overlays for debugging/reporting
  const htfBiasByBar: ("bullish" | "bearish" | "neutral")[] = bars.map(() => structure.htfBias);

  const overlays: EngineV47Overlays = {
    bosMarkers: bosList,
    orderBlocks,
    htfBiasByBar,
    entrySignals: signals,
    momentumStates: momentum,
  };

  return {
    symbol,
    timeframe,
    engineType,
    bars,
    structure,
    bos: bosList,
    orderBlocks,
    momentum,
    signals,
    warnings,
    overlays,
  };
}
