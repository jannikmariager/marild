/**
 * Edge Function: run_backtest_v4
 *
 * Unified Backtest Engine V4 entrypoint.
 * - Uses unified Massive+Yahoo loader (loadUnifiedOHLC)
 * - Supports DAYTRADER, SWING, INVESTOR
 * - Uses engine routing to pick engine_version
 * - Returns normalized V4 backtest result with trades + stats
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { loadUnifiedOHLC, type SupportedTimeframe, SUPPORTED_TIMEFRAMES } from "../_shared/ohlc_loader.ts";
import { runBacktestV4Router, type HighLevelEngineVersion } from "../_shared/backtest/v4_router.ts";
import { CURRENT_BACKTEST_ENGINE, getEngineVersionForStyle } from "../_shared/backtest/engine_version.ts";
import { type EngineType, type OHLCBar } from "../_shared/signal_types.ts";
import { getDaytraderEngineForSymbol, getSwingEngineForSymbol, getInvestorEngineForSymbol } from "../_shared/engine_router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface BacktestRequestBody {
  symbol: string;
  engine_type: EngineType; // 'DAYTRADER' | 'SWING' | 'INVESTOR'
  horizon_days: number;
  timeframe_priority?: string[];
  starting_equity?: number;
}

function getDefaultTimeframes(engine: EngineType): SupportedTimeframe[] {
  switch (engine) {
    case "DAYTRADER":
      return ["1m", "3m", "5m", "15m", "30m"];
    case "SWING":
      return ["4h"];
    case "INVESTOR":
      return ["1d"];
    default:
      return ["1d"];
  }
}

function normalizeTimeframe(tf: string): SupportedTimeframe | null {
  const lower = tf.toLowerCase();
  const found = (SUPPORTED_TIMEFRAMES as readonly string[]).find((t) => t === lower);
  return (found as SupportedTimeframe | undefined) ?? null;
}

async function resolveEngineVersion(symbol: string, engine: EngineType, timeframe: string): Promise<'V3' | 'V3_5' | 'V4' | 'V4_1' | null> {
  const upper = symbol.toUpperCase();
  if (engine === 'DAYTRADER') {
    const v = await getDaytraderEngineForSymbol(upper);
    return v as any;
  }
  if (engine === 'SWING') {
    const v = await getSwingEngineForSymbol(upper, timeframe.toLowerCase());
    return v as any;
  }
  if (engine === 'INVESTOR') {
    const v = await getInvestorEngineForSymbol(upper);
    return v as any;
  }
  return null;
}

async function loadBarsWithPriority(
  symbol: string,
  engine: EngineType,
  timeframePriority: string[] | undefined,
  horizonDays: number,
): Promise<{ bars: OHLCBar[]; timeframeUsed: SupportedTimeframe; fallbackUsed: boolean } | null> {
  const priority = (timeframePriority && timeframePriority.length > 0)
    ? timeframePriority
    : getDefaultTimeframes(engine);

  let lastError: unknown = null;

  for (let i = 0; i < priority.length; i++) {
    const tfStr = priority[i];
    const tf = normalizeTimeframe(tfStr);
    if (!tf) continue;

    try {
      const bars: OHLCBar[] = await loadUnifiedOHLC(symbol, tf, horizonDays);
      if (bars && bars.length > 0) {
        return { bars, timeframeUsed: tf, fallbackUsed: i > 0 };
      }
    } catch (err) {
      lastError = err;
      console.error(`[run_backtest_v4] Failed to load ${symbol}/${tfStr}:`, err);
      continue;
    }
  }

  console.error(`[run_backtest_v4] Exhausted timeframe priority for ${symbol}`);
  if (lastError) console.error(lastError);
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const body = (await req.json()) as BacktestRequestBody;
    const symbol = body.symbol?.toUpperCase();
    const engine_type = body.engine_type;
    const horizon_days = body.horizon_days;
    const timeframe_priority = body.timeframe_priority;
    const starting_equity = body.starting_equity ?? 100_000;

    if (!symbol || !engine_type || !horizon_days) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    console.log(`[run_backtest_v4] Starting backtest for ${symbol} (${engine_type}), horizon=${horizon_days}d`);

    // 1. Load bars with priority across timeframes
    const loadResult = await loadBarsWithPriority(symbol, engine_type, timeframe_priority, horizon_days);
    if (!loadResult) {
      return new Response(JSON.stringify({ error: "DATA_UNAVAILABLE", message: "No OHLC data found for requested configuration" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const { bars, timeframeUsed, fallbackUsed } = loadResult;

    // 2. Resolve engine version from routing tables
    const engine_version = await resolveEngineVersion(symbol, engine_type, timeframeUsed);
    if (!engine_version) {
      return new Response(JSON.stringify({ error: "UNAPPROVED_TICKER", message: "Ticker not approved for this engine" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    console.log(`[run_backtest_v4] Using engine_version=${engine_version}, timeframe=${timeframeUsed}, bars=${bars.length}`);

    // 3. Run V4/V5 backtest via high-level router
    const envOverride = Deno.env.get("BACKTEST_ENGINE") as HighLevelEngineVersion | undefined;
    const highLevelVersion: HighLevelEngineVersion = envOverride ?? getEngineVersionForStyle(engine_type);
    const result = await runBacktestV4Router(
      highLevelVersion,
      {
        engine_type,
        engine_version,
        symbol,
        timeframe: timeframeUsed,
        starting_equity,
      },
      bars,
    );

    const responsePayload = {
      ticker: symbol,
      timeframe_used: result.timeframe_used,
      bars_loaded: result.bars_loaded,
      trades: result.trades,
      stats: result.stats,
      data_source_used: "Massive+Yahoo",
      fallback_used: fallbackUsed,
      anomalies: result.anomalies,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (error: any) {
    console.error("[run_backtest_v4] Error:", error);
    return new Response(JSON.stringify({
      error: "INTERNAL_ERROR",
      message: error?.message ?? String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
