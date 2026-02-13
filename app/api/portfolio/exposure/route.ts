import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.marild.com",
  "https://marild.vercel.app",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
];
const PREVIEW_ORIGIN_SUFFIXES = [".vercel.app"];
const ALLOWED_METHODS = "GET,OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, Supabase-Access-Token";

type ExposureResponse = {
  equity: number | null;
  netExposurePct: number | null;
  longPct: number | null;
  shortPct: number | null;
  cashPct: number | null;
  longValue: number | null;
  shortValue: number | null;
  cashValue: number | null;
  asOf: string | null;
};

type SnapshotRow = {
  equity_dollars: number | string | null;
  cash_dollars: number | string | null;
  timestamp: string | null;
};

type PositionRow = {
  side: string | null;
  size_shares: number | string | null;
  current_price: number | string | null;
  entry_price: number | string | null;
};

const EMPTY_EXPOSURE: ExposureResponse = {
  equity: null,
  netExposurePct: null,
  longPct: null,
  shortPct: null,
  cashPct: null,
  longValue: null,
  shortValue: null,
  cashValue: null,
  asOf: null,
};

const ACTIVE_STRATEGY = "SWING";

function parseEnvAllowedOrigins() {
  return process.env.CORS_ALLOWED_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean);
}

function isOriginAllowed(origin: string) {
  const envOrigins = parseEnvAllowedOrigins();
  const whitelist = new Set([...DEFAULT_ALLOWED_ORIGINS, ...(envOrigins ?? [])]);
  if (whitelist.has(origin)) {
    return true;
  }
  return PREVIEW_ORIGIN_SUFFIXES.some(suffix => origin.endsWith(suffix));
}

function applyCorsHeaders(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get("origin") ?? request.headers.get("Origin");

  if (origin && isOriginAllowed(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.append("Vary", "Origin");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", "600");

  return response;
}

function jsonWithCors(request: NextRequest, data: Record<string, unknown>, init?: ResponseInit) {
  return applyCorsHeaders(request, NextResponse.json(data, init));
}

function unauthorized(request: NextRequest, message = "Unauthorized") {
  return jsonWithCors(request, { error: message }, { status: 401 });
}

function serverError(request: NextRequest, message = "Server not configured") {
  return jsonWithCors(request, { error: message }, { status: 500 });
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

function computeExposure(snapshot: SnapshotRow | null, positions: PositionRow[] | null): ExposureResponse {
  if (!snapshot) {
    return { ...EMPTY_EXPOSURE };
  }

  const equity = toNumber(snapshot.equity_dollars);
  if (equity == null || !Number.isFinite(equity)) {
    return { ...EMPTY_EXPOSURE };
  }

  let longValue = 0;
  let shortValue = 0;

  if (Array.isArray(positions)) {
    for (const position of positions) {
      if (!position) continue;
      const shares = toNumber(position.size_shares);
      if (shares == null || shares === 0) continue;

      const price = toNumber(position.current_price) ?? toNumber(position.entry_price);
      if (price == null || price === 0) continue;

      const notional = Math.abs(shares * price);
      if (!Number.isFinite(notional) || notional <= 0) continue;

      if ((position.side || "").toUpperCase() === "SHORT") {
        shortValue += notional;
      } else {
        longValue += notional;
      }
    }
  }

  const netLong = longValue - shortValue;
  const cashSnapshot = toNumber(snapshot.cash_dollars);
  const cashValue = cashSnapshot ?? equity - netLong;
  const denominator = equity > 0 ? equity : null;

  const ratio = (value: number | null) => {
    if (denominator == null || value == null) {
      return null;
    }
    return value / denominator;
  };

  return {
    equity,
    netExposurePct: ratio(netLong),
    longPct: ratio(longValue),
    shortPct: ratio(shortValue),
    cashPct: ratio(cashValue),
    longValue,
    shortValue,
    cashValue,
    asOf: snapshot.timestamp ?? null,
  };
}

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return unauthorized(request);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return unauthorized(request);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return serverError(request, "Supabase admin env vars missing");
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return unauthorized(request);
  }

  try {
    const { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from("live_portfolio_state")
      .select("equity_dollars, cash_dollars, timestamp")
      .eq("strategy", ACTIVE_STRATEGY)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshotError) {
      console.error("[portfolio/exposure] Failed to fetch portfolio snapshot:", snapshotError);
      return jsonWithCors(request, EMPTY_EXPOSURE);
    }

    const { data: positions, error: positionsError } = await supabaseAdmin
      .from("live_positions")
      .select("side, size_shares, current_price, entry_price")
      .eq("strategy", ACTIVE_STRATEGY);

    if (positionsError) {
      console.error("[portfolio/exposure] Failed to fetch positions:", positionsError);
      return jsonWithCors(request, EMPTY_EXPOSURE);
    }

    const payload = computeExposure(snapshot, positions);
    return jsonWithCors(request, payload);
  } catch (error) {
    console.error("[portfolio/exposure] Unexpected error:", error);
    return jsonWithCors(request, EMPTY_EXPOSURE);
  }
}
