/**
 * Backtest Engine V4
 * Similar to V4.1 but with slightly more conservative entry rules
 */

import { BacktestParams, BacktestResult } from './shared_types';
import { backtestV4_1 } from './backtest_v4_1';

export async function backtestV4(params: BacktestParams): Promise<BacktestResult> {
  // V4 uses same logic as V4.1 for now (can be differentiated later)
  return backtestV4_1(params);
}
