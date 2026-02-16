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

const deriveCloseDateKey = (row: Pick<LiveTradeRow, "realized_pnl_date" | "exit_timestamp">): string | null => {
  return row.realized_pnl_date ?? parseDateKeyFromExitTs(row.exit_timestamp);
};

const dateKeyToDate = (dateKey: string): Date => {
  // Interpret a YYYY-MM-DD key as a calendar day; use midday UTC to avoid DST edge cases.
  // Weekday formatting uses TIMEZONE explicitly.
  return new Date(`${dateKey}T12:00:00Z`);
};

const isWeekdayDow = (dow: string) => dow === "Mon" || dow === "Tue" || dow === "Wed" || dow === "Thu" || dow === "Fri";

const startOfNyWeekMondayFromTodayKey = (todayKey: string): Date => {
  // todayKey is already computed in America/New_York via nyDateKey(new Date()).
  // Base calculations on that key to ensure week rollover happens on NY midnight.
  const cursor = dateKeyToDate(todayKey);
  const dow = nyDow(cursor);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const back = map[dow] ?? 0;
  cursor.setUTCDate(cursor.getUTCDate() - back);
  return cursor;
};

const currentWeekTradingDaysFromTodayKey = (todayKey: string): Array<{ date: string; dow: string }> => {
  const monday = startOfNyWeekMondayFromTodayKey(todayKey);
  const days: Array<{ date: string; dow: string }> = [];
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const dow = nyDow(d);
    if (!isWeekdayDow(dow)) {
      continue;
    }
    days.push({ date: nyDateKey(d), dow });
  }
  return days;
};

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

  const now = new Date();
  const todayKey = nyDateKey(now);

  const tradingDays = currentWeekTradingDaysFromTodayKey(todayKey);
  const startDate = tradingDays[0]?.date ?? null;
  const endDate = tradingDays[tradingDays.length - 1]?.date ?? null;

  if (!startDate || !endDate) {
    return json(request, {
      timezone: TIMEZONE,
      start_date: null,
      end_date: null,
      total_realized_pnl: 0,
      days: [],
    });
  }

  // Pull closed trades in the week window.
  const { data: weekTrades, error: weekTradesError } = await supabaseAdmin
    .from("live_trades")
    .select("realized_pnl_dollars, realized_pnl_date, exit_timestamp")
    .eq("strategy", STRATEGY)
    .eq("engine_key", ENGINE_KEY)
    .not("realized_pnl_dollars", "is", null)
    .not("exit_timestamp", "is", null)
    .gte("realized_pnl_date", startDate)
    .lte("realized_pnl_date", endDate)
    .limit(5000);

  if (weekTradesError) {
    return json(request, { error: "Failed to load weekly performance" }, { status: 500 });
  }

  const byDate = new Map<string, { pnl: number; trades: number }>();
  for (const day of tradingDays) {
    byDate.set(day.date, { pnl: 0, trades: 0 });
  }

  for (const row of (weekTrades ?? []) as LiveTradeRow[]) {
    const realized = typeof row.realized_pnl_dollars === "number" ? row.realized_pnl_dollars : 0;
    const key = deriveCloseDateKey(row);
    if (!key) continue;
    const bucket = byDate.get(key);
    if (!bucket) continue;
    bucket.pnl += realized;
    bucket.trades += 1;
  }

  const days = tradingDays.map((d) => {
    const bucket = byDate.get(d.date) ?? { pnl: 0, trades: 0 };
    const rounded = Math.round(bucket.pnl * 100) / 100;

    // If the day is in the past (or today) and there are no trades, label as market closed.
    // We cannot reliably distinguish "no trades" vs "holiday" here, but the UI requested a closed-market label.
    const marketClosed = d.date <= todayKey && bucket.trades === 0;

    return {
      date: d.date,
      dow: d.dow,
      realized_pnl: rounded,
      market_closed: marketClosed,
    };
  });

  const total = Math.round(days.reduce((sum, d: any) => sum + Number(d.realized_pnl ?? 0), 0) * 100) / 100;

  return json(request, {
    timezone: TIMEZONE,
    start_date: startDate,
    end_date: endDate,
    total_realized_pnl: total,
    days,
  });
}
