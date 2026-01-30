/**
 * Unified OHLC Loader: Massive (Historical) + Yahoo V8 (Incremental)
 * 
 * ARCHITECTURE:
 * - Massive: Static historical OHLC downloaded once, stored in ohlc-cache-v2
 * - Yahoo V8: ONLY source of new/incremental bars going forward
 * 
 * TIMEFRAME STRATEGY:
 * - Massive-only (no Yahoo updates): 1m, 3m, 1w, 1mo
 * - Massive + Yahoo incremental: 5m, 15m, 30m, 1h, 1d
 * - Aggregated from 1h (with Yahoo updates): 4h
 *   (Yahoo fetches latest 1h bars, then aggregates to 4h buckets)
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { OHLCBar } from "./signal_types.ts";
import { fetchChart } from "./yahoo_v8_client.ts";

// LOCAL_OHLC_DIR is only available during local development/backtest
// In Supabase Edge Functions, this path doesn't exist, so we set it to null
// to force fallback to Supabase storage (ohlc-cache-v2 bucket)
const LOCAL_OHLC_DIR = Deno.env.get('LOCAL_OHLC_DIR') || null;
if (LOCAL_OHLC_DIR) {
  console.log("[V4.6 Loader] Using local OHLC dir:", LOCAL_OHLC_DIR);
} else {
  console.log("[V4.6 Loader] LOCAL_OHLC_DIR not set - using Supabase storage (ohlc-cache-v2)");
}

export { LOCAL_OHLC_DIR };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/**
 * Resolve a local JSONL file for a given symbol/timeframe when LOCAL_OHLC_DIR
 * is set. Returns null when no local file exists.
 */
function resolveLocalFile(symbol: string, timeframe: string): string | null {
  if (!LOCAL_OHLC_DIR) return null;
  
  // Try .json first (newer Polygon format), then fall back to .jsonl (legacy)
  const jsonPath = `${LOCAL_OHLC_DIR}/${symbol}_${timeframe}.json`;
  try {
    Deno.statSync(jsonPath);
    return jsonPath;
  } catch {
    // Fall back to .jsonl
    const jsonlPath = `${LOCAL_OHLC_DIR}/${symbol}_${timeframe}.jsonl`;
    try {
      Deno.statSync(jsonlPath);
      return jsonlPath;
    } catch {
      return null;
    }
  }
}

/**
 * Path-based local loader used in LOCAL_OHLC_DIR mode.
 * Accepts either Massive NDJSON format {t,o,h,l,c,v} or normalized
 * {timestamp,open,high,low,close,volume} rows.
 */
async function loadLocalOHLC(path: string): Promise<OHLCBar[]> {
  const text = await Deno.readTextFile(path);
  
  // Check if it's .json (Polygon API format with {results:[...]})
  if (path.endsWith('.json')) {
    try {
      const parsed = JSON.parse(text);
      const results = parsed.results || [];
      const bars: OHLCBar[] = [];
      
      for (const o of results) {
        const tsMs = typeof o.t === "number"
          ? (o.t < 10_000_000_000 ? o.t * 1000 : o.t)
          : Date.parse(o.timestamp);

        if (!Number.isFinite(tsMs)) continue;

        bars.push({
          timestamp: new Date(tsMs).toISOString(),
          open: Number(o.o ?? o.open),
          high: Number(o.h ?? o.high),
          low: Number(o.l ?? o.low),
          close: Number(o.c ?? o.close),
          volume: Number(o.v ?? o.volume ?? 0),
        });
      }
      
      bars.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      return bars;
    } catch (e) {
      console.error(`[ohlc_loader] Failed to parse JSON file ${path}:`, e);
      return [];
    }
  }
  
  // Otherwise handle as .jsonl (line-delimited)
  const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);

  const bars: OHLCBar[] = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      const tsMs = typeof o.t === "number"
        ? (o.t < 10_000_000_000 ? o.t * 1000 : o.t)
        : Date.parse(o.timestamp);

      if (!Number.isFinite(tsMs)) continue;

      bars.push({
        timestamp: new Date(tsMs).toISOString(),
        open: Number(o.o ?? o.open),
        high: Number(o.h ?? o.high),
        low: Number(o.l ?? o.low),
        close: Number(o.c ?? o.close),
        volume: Number(o.v ?? o.volume ?? 0),
      });
    } catch {
      continue;
    }
  }

  bars.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return bars;
}

let supabase: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.warn("[ohlc_loader] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; Supabase-backed loaders are disabled for local runs");
}

const BUCKET_NAME = "ohlc-cache-v2";

/**
 * Normalized internal bar representation used for merging Massive + Yahoo
 */
interface NormalizedBar {
  t: number; // UTC ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Supported OHLC timeframes
 */
export const SUPPORTED_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1mo",
] as const;

export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

/**
 * Timeframes that receive Yahoo V8 incremental updates
 */
const YAHOO_UPDATED_TIMEFRAMES: SupportedTimeframe[] = [
  "5m",
  "15m",
  "30m",
  "1h",
  "1d",
];

/**
 * Check if a timeframe receives Yahoo updates
 */
function isYahooUpdated(tf: SupportedTimeframe): boolean {
  return YAHOO_UPDATED_TIMEFRAMES.includes(tf);
}

/**
 * Load Massive historical OHLC from cache (read-only, no modifications)
 *
 * LOCAL-FIRST behavior:
 * - If LOCAL_OHLC_DIR is set, read {symbol}_{timeframe}.jsonl from local filesystem.
 * - Otherwise, fall back to Supabase storage as before.
 */
async function loadMassiveHistorical(
  symbol: string,
  timeframe: SupportedTimeframe,
): Promise<OHLCBar[]> {
  const fileName = `${symbol}_${timeframe}.jsonl`;

  // 1) LOCAL-FIRST: try filesystem via LOCAL_OHLC_DIR
  const localPath = resolveLocalFile(symbol, timeframe);
  if (localPath) {
    console.log(
      `[ohlc_loader] LOCAL MODE  loading ${fileName} from filesystem`,
    );
    const bars = await loadLocalOHLC(localPath);
    console.log(
      `[ohlc_loader] Loaded ${bars.length} bars locally for ${symbol}/${timeframe}`,
    );
    return bars;
  }

  // 2) Supabase fallback when no local file is present
  if (!supabase) {
    console.warn(
      "[ohlc_loader] Supabase client not configured; cannot load Massive OHLC for",
      symbol,
      timeframe,
    );
    return [];
  }

  const remotePath = fileName;
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(remotePath);

  if (error || !data) {
    console.warn(
      `[ohlc_loader] Missing Massive OHLC file: ${remotePath} (${error?.message ?? "no data"})`,
    );
    return [];
  }

  const text = await data.text();
  const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);

  const bars: OHLCBar[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      // Massive raw format: {t,o,h,l,c,v}
      if (parsed.t !== undefined && parsed.o !== undefined) {
        const tsMs = typeof parsed.t === "number"
          ? (parsed.t < 10_000_000_000 ? parsed.t * 1000 : parsed.t)
          : Date.parse(parsed.t);

        if (!Number.isFinite(tsMs)) continue;

        bars.push({
          timestamp: new Date(tsMs).toISOString(),
          open: Number(parsed.o),
          high: Number(parsed.h),
          low: Number(parsed.l),
          close: Number(parsed.c),
          volume: Number(parsed.v ?? 0),
        });
        continue;
      }

      // Normalized format: {timestamp,open,high,low,close,volume}
      if (parsed.timestamp && parsed.open !== undefined) {
        const tsMs = Date.parse(parsed.timestamp);
        if (!Number.isFinite(tsMs)) continue;

        bars.push({
          timestamp: new Date(tsMs).toISOString(),
          open: Number(parsed.open),
          high: Number(parsed.high),
          low: Number(parsed.low),
          close: Number(parsed.close),
          volume: Number(parsed.volume ?? 0),
        });
      }
    } catch {
      // Silently skip malformed lines
    }
  }

  // Sort ascending by timestamp and dedupe
  bars.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const deduped: OHLCBar[] = [];
  const seen = new Set<number>();

  for (const bar of bars) {
    const ts = new Date(bar.timestamp).getTime();
    if (seen.has(ts)) continue;
    seen.add(ts);
    deduped.push(bar);
  }

  return deduped;
}

/**
 * Fetch incremental Yahoo V8 bars newer than last cached timestamp
 */
async function fetchYahooIncremental(
  symbol: string,
  timeframe: SupportedTimeframe,
  lastTimestamp: number,
): Promise<OHLCBar[]> {
  if (LOCAL_OHLC_DIR) {
    console.log(`[ohlc_loader] LOCAL MODE – skipping Yahoo for ${symbol}/${timeframe}`);
    return [];
  }
  const intervalMap: Record<SupportedTimeframe, { interval: string; range: string }> = {
    "1m": { interval: "1m", range: "1d" },
    "3m": { interval: "5m", range: "1d" },
    "5m": { interval: "5m", range: "1mo" },   // Increased from 5d to 1mo for daytrader
    "15m": { interval: "15m", range: "1mo" },  // Increased from 5d to 1mo
    "30m": { interval: "30m", range: "1mo" },  // Increased from 5d to 1mo
    "1h": { interval: "1h", range: "2y" },     // Increased from 1mo to 2y for swing 4h aggregation
    "4h": { interval: "1h", range: "2y" },     // Fetch 2y of 1h bars for aggregation to 4h
    "1d": { interval: "1d", range: "2y" },     // Increased from 6mo to 2y
    "1w": { interval: "1wk", range: "5y" },    // Increased from 2y to 5y
    "1mo": { interval: "1mo", range: "max" },   // Maximum history
  };

  const config = intervalMap[timeframe];
  if (!config) {
    console.warn(`[ohlc_loader] No Yahoo interval mapping for ${timeframe}`);
    return [];
  }

  try {
    const chartData = await fetchChart({
      symbol,
      interval: config.interval as any,
      range: config.range as any,
    });

    if (!chartData || !chartData.timestamps || chartData.timestamps.length === 0) {
      return [];
    }

    const { timestamps, opens, highs, lows, closes, volumes } = chartData;

    const bars: OHLCBar[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const tsMs = timestamps[i] * 1000;

      // Only include bars AFTER last cached timestamp
      if (tsMs <= lastTimestamp) continue;

      const open = opens[i];
      const high = highs[i];
      const low = lows[i];
      const close = closes[i];

      if (
        open == null ||
        high == null ||
        low == null ||
        close == null ||
        open <= 0 ||
        high <= 0 ||
        low <= 0 ||
        close <= 0
      ) {
        continue;
      }

      bars.push({
        timestamp: new Date(tsMs).toISOString(),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volumes[i] ?? 0),
      });
    }

    console.log(
      `[ohlc_loader] Fetched ${bars.length} new Yahoo bars for ${symbol}/${timeframe} after ${new Date(lastTimestamp).toISOString()}`,
    );
    return bars;
  } catch (error) {
    console.error(
      `[ohlc_loader] Yahoo fetch failed for ${symbol}/${timeframe}:`,
      error,
    );
    return [];
  }
}

/**
 * Write merged OHLC bars back to cache (Massive format: {t,o,h,l,c,v})
 */
async function writeMergedCache(
  symbol: string,
  timeframe: SupportedTimeframe,
  bars: OHLCBar[],
): Promise<void> {
  // In local backtest mode we never write back to Supabase.
  if (LOCAL_OHLC_DIR) {
    console.log(
      `[ohlc_loader] LOCAL MODE  skipping Supabase cache write for ${symbol}/${timeframe}`,
    );
    return;
  }

  if (!supabase) {
    console.warn(
      "[ohlc_loader] Supabase client not configured; skipping cache write for",
      symbol,
      timeframe,
    );
    return;
  }

  const remotePath = `${symbol}_${timeframe}.jsonl`;

  // Convert to Massive JSONL format
  const jsonlContent = bars
    .map((bar) => {
      const ts = new Date(bar.timestamp).getTime();
      return JSON.stringify({
        t: ts,
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.volume,
      });
    })
    .join("\n");

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(remotePath, new Blob([jsonlContent], { type: "application/x-ndjson" }), {
      upsert: true,
      contentType: "application/x-ndjson",
    });

  if (error) {
    console.error(
      `[ohlc_loader] Failed to write merged cache for ${symbol}/${timeframe}:`,
      error,
    );
  } else {
    console.log(
      `[ohlc_loader] Wrote ${bars.length} bars to ${remotePath}`,
    );
  }
}

/**
 * UNIFIED OHLC LOADER: Massive (historical) + Yahoo V8 (incremental)
 * 
 * Strategy:
 * 1. Load Massive historical bars from ohlc-cache-v2
 * 2. Detect newest timestamp
 * 3. Fetch newer bars from Yahoo V8 (only for supported timeframes)
 * 4. Merge, dedupe, sort
 * 5. Write back to cache (non-blocking)
 * 6. Return merged result
 */

/**
 * Minimum bar requirements by timeframe group.
 * These thresholds are used to detect obviously corrupt / truncated datasets
 * for backtests. Signals can call loadMassiveOHLC (which delegates here
 * without horizonDays) and will not enforce horizon-specific thresholds.
 */
function getMinBarsRequired(timeframe: string, horizonDays?: number): number {
  // Default safety values
  const DEFAULTS: Record<string, number> = {
    "1m": 2000,
    "3m": 1500,
    "5m": 1000,
    "15m": 500,
    "30m": 300,
    "1h": 300,
    "4h": 150,
    "1d": 300,
    "1w": 52,
    "1mo": 12,
  };

  // If not horizon-based, return defaults
  if (!horizonDays) return DEFAULTS[timeframe] ?? 100;

  // ---------------------------------------------
  // INVESTOR LOGIC (timeframe = 1d)
  // ---------------------------------------------
  if (timeframe === "1d") {
    // Horizon  365 days  allow as low as 150 bars
    if (horizonDays <= 365) return 150;

    // Horizon > 365  require at least 300 bars (default)
    return 300;
  }

  // ---------------------------------------------
  // DAYTRADER / SWING logic remains unchanged
  // ---------------------------------------------
  return DEFAULTS[timeframe] ?? 100;
}

/**
 * Normalize OHLCBar array to internal {t,o,h,l,c,v} representation.
 */
function normalizeBars(bars: OHLCBar[]): NormalizedBar[] {
  return bars.map((b) => ({
    t: new Date(b.timestamp).getTime(),
    o: Number(b.open),
    h: Number(b.high),
    l: Number(b.low),
    c: Number(b.close),
    v: Number(b.volume ?? 0),
  })).filter((b) => Number.isFinite(b.t) && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0);
}

/**
 * Core unified loader implementation shared by all consumers.
 *
 * - Loads Massive historical base
 * - Fetches Yahoo incremental (if supported timeframe)
 * - Normalizes timestamps to UTC ms
 * - Merges Massive (history) + Yahoo (recent) in a gap-resilient way
 * - Applies horizon filtering relative to the *latest* timestamp, not wall-clock now
 */
async function loadUnifiedInternal(
  symbol: string,
  timeframe: SupportedTimeframe,
  horizonDays?: number,
): Promise<OHLCBar[]> {
  const remotePath = `${symbol}_${timeframe}.jsonl`;
  console.log(
    `[ohlc_loader] Loading ${remotePath} via unified loader (Massive + Yahoo incremental)`,
  );

  // Step 1: Load Massive historical (LOCAL_OHLC_DIR-aware & local-first)
  const massiveBars = await loadMassiveHistorical(symbol, timeframe);
  const massiveNorm = normalizeBars(massiveBars);

  // Track last Massive timestamp (may be 0 if no data)
  const lastMassiveTs = massiveNorm.length
    ? massiveNorm[massiveNorm.length - 1].t
    : 0;

  // Step 2: Optionally load Yahoo incremental (skipped entirely in LOCAL_OHLC_DIR mode)
  let yahooNorm: NormalizedBar[] = [];
  if (!LOCAL_OHLC_DIR && isYahooUpdated(timeframe)) {
    const yahooBars = await fetchYahooIncremental(symbol, timeframe, lastMassiveTs);
    yahooNorm = normalizeBars(yahooBars);
  }

  if (massiveNorm.length === 0 && yahooNorm.length === 0) {
    console.warn(`[ohlc_loader] No Massive or Yahoo data for ${symbol}/${timeframe}`);
    return [];
  }

  // Step 3: Merge history correctly
  let merged: NormalizedBar[] = [];

  if (massiveNorm.length > 0 && yahooNorm.length > 0) {
    const firstYahooTs = yahooNorm[0].t;
    const massiveHead = massiveNorm.filter((b) => b.t < firstYahooTs);
    merged = massiveHead.concat(yahooNorm);
  } else if (massiveNorm.length > 0) {
    merged = massiveNorm;
  } else {
    merged = yahooNorm;
  }

  // Sort and dedupe by timestamp
  merged.sort((a, b) => a.t - b.t);
  const deduped: NormalizedBar[] = [];
  const seenTs = new Set<number>();
  for (const b of merged) {
    if (seenTs.has(b.t)) continue;
    seenTs.add(b.t);
    deduped.push(b);
  }

  if (deduped.length === 0) {
    console.warn(`[ohlc_loader] Merged dataset empty for ${symbol}/${timeframe}`);
    return [];
  }

  // Step 4: Gap-resilient horizon filtering based on latest available bar
  let horizonFiltered = deduped;
  if (horizonDays && horizonDays > 0) {
    const maxTimestamp = deduped[deduped.length - 1].t;
    const effectiveStart = maxTimestamp - horizonDays * DAY_MS;
    horizonFiltered = deduped.filter((b) => b.t >= effectiveStart);
  }

  // Sanity: sort again after filtering (cheap)
  horizonFiltered.sort((a, b) => a.t - b.t);

  // Step 5: Minimum bar count validation (only when horizonDays provided)
  if (horizonDays && horizonDays > 0) {
    const minRequired = getMinBarsRequired(timeframe, horizonDays);
    if (minRequired > 0 && horizonFiltered.length < minRequired) {
      throw new Error(
        `[loadUnifiedOHLC] INSUFFICIENT_DATA for ${symbol}/${timeframe}: have ${horizonFiltered.length}, need >=${minRequired}`,
      );
    }
  }

  // Final: convert back to OHLCBar (ISO timestamps) for consumers
  const finalBars: OHLCBar[] = horizonFiltered.map((b) => ({
    timestamp: new Date(b.t).toISOString(),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));

  // Non-blocking cache write of merged *full* history (without horizon filter)
  writeMergedCache(symbol, timeframe, massiveBars.length ? massiveBars : finalBars).catch((err) =>
    console.error(`[ohlc_loader] Non-blocking cache write failed:`, err),
  );

  return finalBars;
}

/**
 * Legacy entrypoint kept for compatibility.
 * Delegates to the unified loader without horizon trimming.
 */
export async function loadMassiveOHLC(
  symbol: string,
  timeframe: SupportedTimeframe | string,
): Promise<OHLCBar[]> {
  return await loadUnifiedInternal(symbol, timeframe as SupportedTimeframe);
}

/**
 * New unified loader entrypoint for backtests and advanced callers.
 *
 * @param symbol      Ticker symbol (e.g. "AAPL")
 * @param timeframe   One of SUPPORTED_TIMEFRAMES
 * @param horizonDays Optional logical horizon in days; trimming is based on the
 *                    *latest* available bar timestamp, not wall-clock now.
 */
export async function loadUnifiedOHLC(
  symbol: string,
  timeframe: SupportedTimeframe | string,
  horizonDays?: number,
): Promise<OHLCBar[]> {
  return await loadUnifiedInternal(symbol, timeframe as SupportedTimeframe, horizonDays);
}

/**
 * Aggregate 1h bars to 4h bars using UTC 4-hour buckets.
 */
export function aggregate1hTo4h(bars: OHLCBar[]): OHLCBar[] {
  if (bars.length === 0) return [];

  const result: OHLCBar[] = [];
  let currentBucket: OHLCBar[] = [];

  const flushBucket = () => {
    if (currentBucket.length === 0) return;
    const first = currentBucket[0];
    const last = currentBucket[currentBucket.length - 1];

    const high = Math.max(...currentBucket.map((b) => b.high));
    const low = Math.min(...currentBucket.map((b) => b.low));
    const volume = currentBucket.reduce((sum, b) => sum + (b.volume || 0), 0);

    result.push({
      timestamp: first.timestamp,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });

    currentBucket = [];
  };

  for (const bar of bars) {
    const ts = new Date(bar.timestamp);
    const hour = ts.getUTCHours();
    const bucketStart = Math.floor(hour / 4) * 4;

    if (currentBucket.length > 0) {
      const lastTs = new Date(currentBucket[0].timestamp);
      const lastHour = lastTs.getUTCHours();
      const lastBucketStart = Math.floor(lastHour / 4) * 4;

      if (
        ts.getUTCFullYear() !== lastTs.getUTCFullYear() ||
        ts.getUTCMonth() !== lastTs.getUTCMonth() ||
        ts.getUTCDate() !== lastTs.getUTCDate() ||
        bucketStart !== lastBucketStart
      ) {
        flushBucket();
      }
    }

    currentBucket.push(bar);
  }

  flushBucket();
  return result;
}

