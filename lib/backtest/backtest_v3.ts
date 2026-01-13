/**
 * Backtest Engine V3
 * Original version - uses V4 logic for now
 */

import { BacktestParams, BacktestResult } from './shared_types';
import { backtestV4 } from './backtest_v4';

export async function backtestV3(params: BacktestParams): Promise<BacktestResult> {
  return backtestV4(params);
}
