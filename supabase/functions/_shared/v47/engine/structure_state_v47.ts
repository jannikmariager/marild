import type { BOSSignal } from "../structure/bos_detector_v47.ts";
import type { OrderBlock } from "../structure/order_blocks_v47.ts";

export interface StructureStateV47 {
  htfBias: "bullish" | "bearish" | "neutral";
  ltfBias: "bullish" | "bearish" | "neutral";
  bosHistory: BOSSignal[];
  activeOBs: OrderBlock[];
}

export function createEmptyStructureState(
  htfBias: "bullish" | "bearish" | "neutral" = "neutral",
): StructureStateV47 {
  return {
    htfBias,
    ltfBias: "neutral",
    bosHistory: [],
    activeOBs: [],
  };
}
