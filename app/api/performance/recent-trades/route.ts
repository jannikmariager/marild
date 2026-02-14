import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActiveEntitlement } from "@/app/api/_lib/entitlement";

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

type LiveTradeRow = {
  ticker: string | null;
  side: string | null;
  entry_price: number | null;
  exit_price: number | null;
  exit_timestamp: string | null;
  realized_pnl_dollars: number | null;
};

const computePctReturn = (row: LiveTradeRow): number | null => {
  const entry = row.entry_price;
  const exit = row.exit_price;
  if (typeof entry !== "number" || !Number.isFinite(entry) || entry === 0) return null;
  if (typeof exit !== "number" || !Number.isFinite(exit)) return null;

  const side = (row.side ?? "LONG").toUpperCase();
  const raw = ((exit - entry) / entry) * 100;
  return side === "SHORT" ? -raw : raw;
};

const minutesAgoFromTs = (iso: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));
};

/**
 * GET /api/performance/recent-trades?days=7&limit=4
 * Returns the best-performing closed trades in the last N days.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isPublicPreview = searchParams.get("public") === "1";

  if (!isPublicPreview) {
    try {
      await requireActiveEntitlement(request);
    } catch (resp: any) {
      if (resp instanceof Response) {
        return applyCors(resp as NextResponse, request);
      }
      return json(request, { error: "subscription_required" }, { status: 403 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return json(request, { error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json(request, { error: "Server not configured" }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // When not public, validate the token belongs to a real user.
  if (!isPublicPreview) {
    const token = getBearerToken(request);
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token as string);

    if (userError || !user) {
      return json(request, { error: "Unauthorized" }, { status: 401 });
    }
  }

  const days = clampInt(Number(searchParams.get("days") ?? 7), 1, 30);
  const limit = clampInt(Number(searchParams.get("limit") ?? 4), 1, 20);

  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startKey = nyDateKey(start);

  // Pull closed trades with realized P&L within the window.
  const { data: rows, error } = await supabaseAdmin
    .from("live_trades")
    .select("ticker, side, entry_price, exit_price, exit_timestamp, realized_pnl_dollars, realized_pnl_date")
    .eq("strategy", "SWING")
    .eq("engine_key", "SWING")
    .not("realized_pnl_dollars", "is", null)
    .not("exit_timestamp", "is", null)
    .gte("realized_pnl_date", startKey)
    .order("realized_pnl_date", { ascending: false })
    .limit(500);

  if (error) {
    return json(request, { error: "Failed to load recent trades" }, { status: 500 });
  }

  const trades = (rows ?? []) as LiveTradeRow[];

  const items = trades
    .map((t) => {
      const pct = computePctReturn(t);
      const closedAt = t.exit_timestamp;
      const minutesAgo = minutesAgoFromTs(closedAt);
      return {
        ticker: t.ticker,
        side: (t.side ?? "LONG").toUpperCase(),
        pct_return: pct,
        pnl: typeof t.realized_pnl_dollars === "number" ? t.realized_pnl_dollars : null,
        closed_at: closedAt,
        minutes_ago: minutesAgo,
      };
    })
    .filter((x) => Boolean(x.ticker) && typeof x.pct_return === "number" && Number.isFinite(x.pct_return))
    .sort((a, b) => (b.pct_return ?? 0) - (a.pct_return ?? 0))
    .slice(0, limit);

  return json(request, { days, items });
}
