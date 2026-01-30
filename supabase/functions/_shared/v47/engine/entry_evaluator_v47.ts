import type { OHLCBar } from "../../signal_types.ts";
import type { StructureStateV47 } from "./structure_state_v47.ts";
import type { BOSSignal } from "../structure/bos_detector_v47.ts";
import type { OrderBlock } from "../structure/order_blocks_v47.ts";
import type { MomentumStateV47 } from "../indicators/momentum_v47.ts";

export interface V47Signal {
  index: number;
  direction: "long" | "short";
  ob: OrderBlock;
  bos: BOSSignal;
  confidence: number; // 0–100
}

interface EntryContext {
  bars: OHLCBar[];
  structure: StructureStateV47;
  momentumByIndex: Map<number, MomentumStateV47>;
}

function barTapsOrderBlock(bar: OHLCBar, ob: OrderBlock): boolean {
  // Simple overlap check between bar range and OB zone
  const high = bar.high;
  const low = bar.low;
  const zoneHigh = Math.max(ob.high, ob.low);
  const zoneLow = Math.min(ob.high, ob.low);
  return high >= zoneLow && low <= zoneHigh;
}

function computeConfidence(
  direction: "long" | "short",
  structure: StructureStateV47,
  ob: OrderBlock,
  bos: BOSSignal,
  momentum: MomentumStateV47 | undefined,
): number {
  let score = 0;

  // HTF alignment (40)
  if (
    (direction === "long" && structure.htfBias === "bullish") ||
    (direction === "short" && structure.htfBias === "bearish")
  ) {
    score += 40;
  }

  // OB quality (30) – unmitigated and reasonably narrow range
  const range = Math.abs(ob.high - ob.low);
  if (!ob.mitigated && range > 0) {
    score += 30;
  }

  // Momentum (20)
  if (momentum) {
    if (direction === "long" && momentum.longOK) score += 20;
    if (direction === "short" && momentum.shortOK) score += 20;
  }

  // Clean structure (10) – recent BOS all in same direction
  const recent = structure.bosHistory.slice(-3);
  if (recent.length > 0 && recent.every((b) => b.direction === bos.direction)) {
    score += 10;
  }

  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
}

export function evaluateEntriesV47(
  bars: OHLCBar[],
  structure: StructureStateV47,
  momentumStates: MomentumStateV47[],
): V47Signal[] {
  const signals: V47Signal[] = [];

  const momentumByIndex = new Map<number, MomentumStateV47>();
  for (const m of momentumStates) {
    momentumByIndex.set(m.index, m);
  }

  const ctx: EntryContext = { bars, structure, momentumByIndex };

  // Pre-index BOS by bar index for quick lookup
  const bosByIndex = new Map<number, BOSSignal[]>();
  for (const bos of structure.bosHistory) {
    const list = bosByIndex.get(bos.index) ?? [];
    list.push(bos);
    bosByIndex.set(bos.index, list);
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const momentum = ctx.momentumByIndex.get(i);

    // Find the most recent BOS up to this index
    let latestBOS: BOSSignal | null = null;
    for (let j = i; j >= 0; j--) {
      const list = bosByIndex.get(j);
      if (list && list.length > 0) {
        latestBOS = list[list.length - 1];
        break;
      }
    }

    if (!latestBOS) continue;

    // Check active OBs that are not mitigated and tapped by price
    const tappableOBs = structure.activeOBs.filter((ob) => !ob.mitigated && barTapsOrderBlock(bar, ob));
    if (tappableOBs.length === 0) continue;

    for (const ob of tappableOBs) {
      let dir: "long" | "short" | null = null;

      if (
        structure.htfBias === "bullish" &&
        latestBOS.direction === "bullish" &&
        ob.direction === "bullish" &&
        momentum?.longOK
      ) {
        dir = "long";
      }

      if (
        structure.htfBias === "bearish" &&
        latestBOS.direction === "bearish" &&
        ob.direction === "bearish" &&
        momentum?.shortOK
      ) {
        dir = "short";
      }

      if (!dir) continue;

      const confidence = computeConfidence(dir, structure, ob, latestBOS, momentum);
      if (confidence <= 0) continue;

      signals.push({
        index: i,
        direction: dir,
        ob,
        bos: latestBOS,
        confidence,
      });
    }
  }

  return signals;
}
