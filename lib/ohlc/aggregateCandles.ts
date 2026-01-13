/**
 * OHLC Candle Aggregation Utility
 * Aggregates smaller timeframe candles into larger timeframe candles
 * Used primarily for SWING backtests (1H → 4H aggregation)
 */

export interface OHLCCandle {
  timestamp: number; // Unix timestamp (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Aggregates multiple candles into a single candle
 * Standard OHLC aggregation rules:
 * - Open: first candle's open
 * - High: maximum of all highs
 * - Low: minimum of all lows
 * - Close: last candle's close
 * - Volume: sum of all volumes
 * - Timestamp: first candle's timestamp
 */
export function aggregateCandles(candles: OHLCCandle[]): OHLCCandle | null {
  if (candles.length === 0) return null;
  if (candles.length === 1) return candles[0];

  return {
    timestamp: candles[0].timestamp,
    open: candles[0].open,
    high: Math.max(...candles.map(c => c.high)),
    low: Math.min(...candles.map(c => c.low)),
    close: candles[candles.length - 1].close,
    volume: candles.reduce((sum, c) => sum + c.volume, 0),
  };
}

/**
 * Aggregates 1H candles into 4H candles
 * Groups candles into 4-hour windows and aggregates each group
 * 
 * @param hourlyCandles - Array of 1H OHLC candles (sorted by timestamp)
 * @returns Array of 4H aggregated candles
 */
export function aggregate1HTo4H(hourlyCandles: OHLCCandle[]): OHLCCandle[] {
  if (hourlyCandles.length === 0) return [];

  const result: OHLCCandle[] = [];
  let currentGroup: OHLCCandle[] = [];

  for (const candle of hourlyCandles) {
    const candleDate = new Date(candle.timestamp);
    const hour = candleDate.getUTCHours();

    // Group candles into 4-hour buckets: 0-3, 4-7, 8-11, 12-15, 16-19, 20-23
    const bucketStart = Math.floor(hour / 4) * 4;

    // Check if this candle starts a new 4H bucket
    if (currentGroup.length > 0) {
      const lastCandleDate = new Date(currentGroup[0].timestamp);
      const lastHour = lastCandleDate.getUTCHours();
      const lastBucketStart = Math.floor(lastHour / 4) * 4;

      // If different day or different bucket, aggregate current group
      if (
        candleDate.getUTCDate() !== lastCandleDate.getUTCDate() ||
        candleDate.getUTCMonth() !== lastCandleDate.getUTCMonth() ||
        candleDate.getUTCFullYear() !== lastCandleDate.getUTCFullYear() ||
        bucketStart !== lastBucketStart
      ) {
        const aggregated = aggregateCandles(currentGroup);
        if (aggregated) result.push(aggregated);
        currentGroup = [];
      }
    }

    currentGroup.push(candle);
  }

  // Aggregate remaining candles
  if (currentGroup.length > 0) {
    const aggregated = aggregateCandles(currentGroup);
    if (aggregated) result.push(aggregated);
  }

  return result;
}

/**
 * Aggregates candles by a custom factor (e.g., 3 × 5m → 15m)
 * 
 * @param candles - Source candles
 * @param factor - Number of source candles to combine (e.g., 4 for 1H→4H)
 * @returns Array of aggregated candles
 */
export function aggregateCandlesByFactor(
  candles: OHLCCandle[],
  factor: number
): OHLCCandle[] {
  if (factor <= 1 || candles.length === 0) return candles;

  const result: OHLCCandle[] = [];

  for (let i = 0; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    const aggregated = aggregateCandles(group);
    if (aggregated) result.push(aggregated);
  }

  return result;
}
