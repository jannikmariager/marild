/**
 * ENGINE SIGNAL EVALUATION (Backtest V4)
 *
 * Thin wrapper around existing backtest_entry_rules.ts and
 * price_levels_calculator.ts to provide a unified interface:
 *   evaluateEngineSignal(engineType, engineVersion, barsSlice, fundamentals?)
 *
 * It returns a normalized entry decision + SL/TP levels suitable for the
 * V4 execution model (single SL/TP per position).
 */

import {
  EngineType,
  FundamentalsData,
  OHLCBar,
} from "../../signal_types.ts";
import {
  type EntrySignal,
  evaluateDaytraderEntry,
  evaluateSwingEntry,
  evaluateInvestorEntry,
} from "../../backtest_entry_rules.ts";
import {
  calculatePriceLevelsByEngine,
  type PriceLevels,
} from "../../price_levels_calculator.ts";

export interface EvaluatedEngineSignal {
  shouldEnter: boolean;
  direction: 'long' | 'short' | 'none';
  entryPrice: number; // usually close of bar N
  stopLoss: number;
  takeProfit: number;
  reason: string;
}

/**
 * Evaluate entry signal for a given engine + version at a specific bar index.
 *
 * NOTE: engineVersion is accepted for future differentiation (V3/V3_5/V4/V4_1),
 * but current implementation delegates to the deterministic rules in
 * backtest_entry_rules.ts that only depend on engine_type.
 */
export function evaluateEngineSignal(
  engineType: EngineType,
  engineVersion: 'V3' | 'V3_5' | 'V4' | 'V4_1',
  bars: OHLCBar[],
  fundamentals?: FundamentalsData,
): EvaluatedEngineSignal {
  if (!bars || bars.length === 0) {
    return {
      shouldEnter: false,
      direction: 'none',
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      reason: 'No bars provided',
    };
  }

  // Select evaluator based on engine type
  let rawSignal: EntrySignal;
  switch (engineType) {
    case 'DAYTRADER':
      rawSignal = evaluateDaytraderEntry(bars);
      break;
    case 'SWING':
      rawSignal = evaluateSwingEntry(bars);
      break;
    case 'INVESTOR':
      rawSignal = evaluateInvestorEntry(bars, fundamentals);
      break;
    default:
      return {
        shouldEnter: false,
        direction: 'none',
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        reason: `Unsupported engine type: ${engineType}`,
      };
  }

  if (!rawSignal.should_enter || rawSignal.direction === 'none') {
    return {
      shouldEnter: false,
      direction: 'none',
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      reason: rawSignal.reason,
    };
  }

  const currentBar = bars[bars.length - 1];
  const entryPrice = currentBar.close;

  // Use engine-specific ATR-based levels to derive SL/TP
  const levels: PriceLevels = calculatePriceLevelsByEngine(
    engineType,
    entryPrice,
    bars,
    rawSignal.direction,
  );

  return {
    shouldEnter: true,
    direction: rawSignal.direction,
    entryPrice,
    stopLoss: levels.stop_loss,
    takeProfit: levels.take_profit_1, // Use TP1 as primary TP for V4
    reason: rawSignal.reason,
  };
}
