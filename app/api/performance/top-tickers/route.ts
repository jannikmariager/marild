import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEZONE = "America/New_York";

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

const nyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const nyDateKey = (date: Date): string => nyFormatter.format(date); // YYYY-MM-DD

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

type LiveTradeAggRow = {
  ticker: string | null;
  realized_pnl_dollars: number | null;
};

/**
 * GET /api/performance/top-tickers?days=7&limit=5
 * Returns tickers ranked by realized P&L over the last N days.
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
  const days = clampInt(Number(searchParams.get("days") ?? 7), 1, 30);
  const limit = clampInt(Number(searchParams.get("limit") ?? 5), 1, 50);

  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startKey = nyDateKey(start);

  // Fetch trades in window and aggregate in-memory (small volume).
  const { data: rows, error } = await supabaseAdmin
    .from("live_trades")
    .select("ticker, realized_pnl_dollars, realized_pnl_date")
    .eq("strategy", "SWING")
    .eq("engine_key", "SWING")
    .not("realized_pnl_dollars", "is", null)
    .gte("realized_pnl_date", startKey)
    .limit(5000);

  if (error) {
    return json(request, { error: "Failed to load ticker performance" }, { status: 500 });
  }

  const trades = (rows ?? []) as LiveTradeAggRow[];

  const agg = new Map<
    string,
    { pnl: number; wins: number; total: number }
  >();

  for (const t of trades) {
    const ticker = (t.ticker ?? "").trim();
    if (!ticker) continue;
    const pnl = typeof t.realized_pnl_dollars === "number" ? t.realized_pnl_dollars : 0;

    const entry = agg.get(ticker) ?? { pnl: 0, wins: 0, total: 0 };
    entry.pnl += pnl;
    entry.total += 1;
    if (pnl > 0) entry.wins += 1;
    agg.set(ticker, entry);
  }

  const ranked = Array.from(agg.entries())
    .map(([ticker, v]) => ({
      ticker,
      pnl: Math.round(v.pnl * 100) / 100,
      win_rate: v.total > 0 ? (v.wins / v.total) * 100 : null,
      trades: v.total,
    }))
    .sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))
    .slice(0, limit)
    .map((item, idx) => ({
      ...item,
      rank: idx + 1,
      win_rate: item.win_rate != null ? Math.round(item.win_rate) : null,
    }));

  return json(request, { days, items: ranked });
}
