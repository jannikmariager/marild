import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEZONE = "America/New_York";
const WINDOW_START = "10:00";
const WINDOW_END = "15:55";

const ALLOWED_METHODS = "GET,OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, Supabase-Access-Token";

function applyCors(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get("origin") ?? "*";
  response.headers.set("Access-Control-Allow-Origin", origin || "*");
  if (origin) {
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

const json = (request: NextRequest, data: unknown, init?: ResponseInit) =>
  applyCors(NextResponse.json(data, init), request);

export async function OPTIONS(request: NextRequest) {
  return applyCors(new NextResponse(null, { status: 204 }), request);
}

const getBearerToken = (request: NextRequest): string | null => {
  const raw = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

type AiSignalRow = {
  id: string;
  symbol: string;
  signal_type: string | null;
  status: string | null;
  confidence_score: number | null;
  correction_risk: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  signal_bar_ts: string | null;
};

type LivePositionRow = {
  ticker: string | null;
  side: string | null;
};

/**
 * GET /api/signals/daily-focus?limit=8&sort=confidence|symbol
 */
export async function GET(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) {
    return json(request, { error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json(request, { error: "Server not configured" }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return json(request, { error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = clampInt(Number(searchParams.get("limit") ?? 8), 1, 50);
  const sort = (searchParams.get("sort") ?? "confidence").toLowerCase();

  let query = supabaseAdmin
    .from("ai_signals")
    .select(
      "id, symbol, signal_type, status, confidence_score, correction_risk, entry_price, stop_loss, take_profit_1, signal_bar_ts",
    )
    .eq("engine_key", "SWING")
    .eq("engine_type", "SWING")
    .eq("timeframe", "1h")
    .in("status", ["active", "watchlist"])
    .limit(limit);

  if (sort === "symbol") {
    query = query.order("symbol", { ascending: true }).order("signal_bar_ts", { ascending: false });
  } else {
    // Default: confidence
    query = query.order("confidence_score", { ascending: false }).order("signal_bar_ts", { ascending: false });
  }

  const { data: signals, error: signalsError } = await query;

  if (signalsError) {
    return json(request, { error: "Failed to load focus signals" }, { status: 500 });
  }

  // Live status: mark tickers with open positions.
  const { data: openPositions } = await supabaseAdmin
    .from("live_positions")
    .select("ticker, side")
    .eq("strategy", "SWING")
    .eq("engine_key", "SWING");

  const posMap = new Map<string, string>();
  for (const p of (openPositions ?? []) as LivePositionRow[]) {
    const ticker = (p.ticker ?? "").trim();
    if (!ticker) continue;
    const side = (p.side ?? "").toUpperCase();
    if (side === "SHORT") posMap.set(ticker, "LIVE SHORT");
    else if (side) posMap.set(ticker, "LIVE LONG");
  }

  const items = ((signals ?? []) as AiSignalRow[]).map((s) => {
    const st = (s.signal_type ?? "").toLowerCase();
    const signal = st.includes("buy") ? "BUY" : st.includes("sell") ? "SELL" : "—";

    // Normalize confidence/risk to 0-1 fractions for the frontend (but allow nulls).
    const confidence = typeof s.confidence_score === "number" ? s.confidence_score / 100 : null;
    const risk = typeof s.correction_risk === "number" ? s.correction_risk / 100 : null;

    const symbol = s.symbol;

    return {
      symbol,
      signal,
      status: posMap.get(symbol) ?? null,
      confidence,
      risk,
      entry: s.entry_price ?? null,
      stop: s.stop_loss ?? null,
      target: s.take_profit_1 ?? null,
    };
  });

  return json(request, {
    asOf: new Date().toISOString(),
    window: { timezone: TIMEZONE, start: WINDOW_START, end: WINDOW_END },
    items,
  });
}
