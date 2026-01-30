/**
 * RISK MODEL (Backtest V4)
 *
 * Implements:
 * - Position sizing: 1% of equity per trade
 * - R multiple calculation for long and short trades
 */

/**
 * Compute position size based on 1% risk of current equity.
 *
 * risk_amount = equity * 0.01
 * distance   = |entry - stop|
 * size       = risk_amount / distance
 */
export function computePositionSize(
  equity: number,
  entryPrice: number,
  stopLoss: number,
): number {
  if (equity <= 0) return 0;

  const distance = Math.abs(entryPrice - stopLoss);
  if (!Number.isFinite(distance) || distance <= 0) return 0;

  const riskAmount = equity * 0.01; // 1% risk per trade
  const size = riskAmount / distance;

  if (!Number.isFinite(size) || size <= 0) return 0;
  return size;
}

/**
 * Compute R multiple for a closed trade.
 *
 * For LONG:
 *   R = (exit - entry) / (entry - stop)
 * For SHORT:
 *   R = (entry - exit) / (stop - entry)
 */
export function computeRMultiple(
  direction: 'long' | 'short',
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
): number {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(stopLoss)) {
    return 0;
  }

  if (direction === 'long') {
    const denom = entryPrice - stopLoss;
    if (denom === 0) return 0;
    return (exitPrice - entryPrice) / denom;
  } else {
    const denom = stopLoss - entryPrice;
    if (denom === 0) return 0;
    return (entryPrice - exitPrice) / denom;
  }
}

/**
 * Compute PnL in dollars given position size.
 */
export function computePnl(
  direction: 'long' | 'short',
  entryPrice: number,
  exitPrice: number,
  size: number,
): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  const delta = direction === 'long' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
  return delta * size;
}
