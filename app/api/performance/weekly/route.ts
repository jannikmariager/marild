import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActiveEntitlement } from "@/app/api/_lib/entitlement";

export const dynamic = "force-dynamic";
// Ensure this route runs in the Node.js runtime (uses Supabase service role + Intl time zone formatting).
export const runtime = "nodejs";

const TIMEZONE = "America/New_York";
const STRATEGY = "SWING";
const ENGINE_KEY = "SWING";

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

const nyWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
});

const nyDateKey = (date: Date): string => nyFormatter.format(date); // YYYY-MM-DD

const nyDow = (date: Date): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" => {
  const raw = nyWeekdayFormatter.format(date);
  // Intl returns Mon/Tue/... in en-US
  return raw as any;
};

const lastTradingDays = (count: number): Array<{ date: string; dow: string }> => {
  const days: Array<{ date: string; dow: string }> = [];
  const cursor = new Date();

  // walk back calendar days, selecting Mon-Fri in America/New_York
  while (days.length < count) {
    const dow = nyDow(cursor);
    if (dow !== "Sat" && dow !== "Sun") {
      const key = nyDateKey(cursor);
      // avoid duplicates around DST / formatting
      if (!days.some((d) => d.date === key)) {
        days.push({ date: key, dow });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return days.reverse();
};

type LiveTradeRow = {
  realized_pnl_dollars: number | null;
  realized_pnl_date: string | null;
  exit_timestamp: string | null;
};

const parseDateKeyFromExitTs = (exitTimestamp: string | null): string | null => {
  if (!exitTimestamp) return null;
  const d = new Date(exitTimestamp);
  if (Number.isNaN(d.getTime())) return null;
  return nyDateKey(d);
};

export async function GET(request: NextRequest) {
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

  const tradingDays = lastTradingDays(5);
  const startDate = tradingDays[0]?.date;
  const endDate = tradingDays[tradingDays.length - 1]?.date;

  if (!startDate || !endDate) {
    return json(request, {
      timezone: TIMEZONE,
      start_date: null,
      end_date: null,
      total_realized_pnl: 0,
      days: [],
    });
  }

  // Query the smallest reasonable window and then attribute PnL to the close-date key.
  const { data: trades, error: tradesError } = await supabaseAdmin
    .from("live_trades")
    .select("realized_pnl_dollars, realized_pnl_date, exit_timestamp")
    .eq("strategy", STRATEGY)
    .eq("engine_key", ENGINE_KEY)
    .not("realized_pnl_dollars", "is", null)
    .gte("realized_pnl_date", startDate)
    .lte("realized_pnl_date", endDate);

  if (tradesError) {
    return json(request, { error: "Failed to load weekly performance" }, { status: 500 });
  }

  const byDate = new Map<string, number>();
  for (const day of tradingDays) {
    byDate.set(day.date, 0);
  }

  for (const row of (trades ?? []) as LiveTradeRow[]) {
    const realized = typeof row.realized_pnl_dollars === "number" ? row.realized_pnl_dollars : 0;
    const key = row.realized_pnl_date ?? parseDateKeyFromExitTs(row.exit_timestamp);
    if (!key) continue;
    if (!byDate.has(key)) continue;
    byDate.set(key, (byDate.get(key) ?? 0) + realized);
  }

  const days = tradingDays.map((d) => ({
    date: d.date,
    dow: d.dow,
    realized_pnl: Math.round((byDate.get(d.date) ?? 0) * 100) / 100,
  }));

  const total = Math.round(days.reduce((sum, d) => sum + d.realized_pnl, 0) * 100) / 100;

  return json(request, {
    timezone: TIMEZONE,
    start_date: startDate,
    end_date: endDate,
    total_realized_pnl: total,
    days,
  });
}
