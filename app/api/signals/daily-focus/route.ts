import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActiveEntitlement } from "@/app/api/_lib/entitlement";

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

  // Stored scores (may be null or stale)
  confidence_score: number | null;
  correction_risk: number | null;

  // Sub-scores used to compute deterministic confidence/risk
  smc_confidence?: number | null;
  volume_confidence?: number | null;
  sentiment_confidence?: number | null;
  confluence_score?: number | null;
  volatility_state?: string | null;

  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  signal_bar_ts: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type LivePositionRow = {
  ticker: string | null;
  side: string | null;
};

type WhitelistRow = {
  symbol: string | null;
  is_top8: boolean | null;
  manual_priority: number | null;
};

/**
 * GET /api/signals/daily-focus?limit=8&sort=confidence|symbol
 */
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

  const { searchParams } = new URL(request.url);
  const modeRaw = (searchParams.get("mode") ?? "focus").toLowerCase();
  const mode: "focus" | "all" = modeRaw === "all" ? "all" : "focus";
  const sort = (searchParams.get("sort") ?? "confidence").toLowerCase();

  const defaultLimit = mode === "all" ? 32 : 8;
  const limit = clampInt(Number(searchParams.get("limit") ?? defaultLimit), 1, 200);

  // Load tickers from whitelist.
  // - focus => enabled + is_top8
  // - all   => enabled
  let whitelistQuery = supabaseAdmin
    .from("ticker_whitelist")
    .select("symbol, is_top8, manual_priority", { count: "exact" })
    .eq("is_enabled", true);

  if (mode === "focus") {
    whitelistQuery = whitelistQuery.eq("is_top8", true);
  }

  whitelistQuery = whitelistQuery
    .order("is_top8", { ascending: false })
    .order("manual_priority", { ascending: false })
    .order("symbol", { ascending: true })
    .limit(limit);

  const { data: whitelistRows, error: whitelistError, count: whitelistCount } = await whitelistQuery;
  if (whitelistError) {
    return json(request, { error: "Unable to load tickers" }, { status: 500 });
  }

  const whitelist = (whitelistRows ?? []) as WhitelistRow[];

  // Normalize + dedupe (preserve original order after sorting).
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const r of whitelist) {
    const sym = (r.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
  }

  const universeTotal = whitelistCount ?? symbols.length;

  if (symbols.length === 0) {
    return json(request, {
      mode,
      total: universeTotal,
      asOf: new Date().toISOString(),
      window: { timezone: TIMEZONE, start: WINDOW_START, end: WINDOW_END },
      items: [],
    });
  }

  // Fetch latest signals for those symbols.
  // We may have multiple rows per symbol (different bar_ts); dedupe to the latest.
  const { data: signalRows, error: signalsError } = await supabaseAdmin
    .from("ai_signals")
    .select(
      "id, symbol, signal_type, status, confidence_score, correction_risk, smc_confidence, volume_confidence, sentiment_confidence, confluence_score, volatility_state, entry_price, stop_loss, take_profit_1, signal_bar_ts, created_at, updated_at",
    )
    .eq("engine_key", "SWING")
    .eq("engine_type", "SWING")
    .eq("timeframe", "1h")
    .in("status", ["active", "watchlist"])
    .in("symbol", symbols)
    // Pull enough rows to do per-symbol ranking deterministically.
    .order("signal_bar_ts", { ascending: false })
    .order("created_at", { ascending: false })
    .order("confidence_score", { ascending: false })
    .limit(Math.max(1500, symbols.length * 20));

  if (signalsError) {
    return json(request, { error: "Failed to load focus signals" }, { status: 500 });
  }

  const pickSignalTs = (r: AiSignalRow | null): number => {
    if (!r) return 0;
    const raw = r.signal_bar_ts ?? r.updated_at ?? r.created_at ?? null;
    const t = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  };

  const computeConfidenceScore = (r: AiSignalRow | null): number | null => {
    if (!r) return null;

    // Derive confidence from rule alignment.
    // We treat each sub-score as an "available rule bucket".
    const buckets: Array<number | null | undefined> = [
      r.smc_confidence,
      r.volume_confidence,
      r.sentiment_confidence,
      r.confluence_score,
    ];

    const available = buckets.filter((v) => typeof v === "number" && Number.isFinite(v as number)) as number[];
    if (available.length === 0) return typeof r.confidence_score === "number" ? r.confidence_score : null;

    const matched = available.filter((v) => v >= 60).length;
    const ratio = matched / available.length;

    // Base range 35–95.
    let score = 35 + ratio * 60;

    // Regime alignment multiplier (conservative in high/chaotic regimes).
    const vs = (r.volatility_state ?? "").toUpperCase();
    const mult = vs === "EXTREME" ? 0.82 : vs === "HIGH" ? 0.9 : vs === "LOW" ? 0.97 : 1.0;
    score = score * mult;

    // Clamp 35–95.
    score = Math.max(35, Math.min(95, score));
    return Math.round(score);
  };

  const computeRiskScore = (r: AiSignalRow | null): number | null => {
    if (!r) return null;

    // Prefer a computed deterministic risk over static placeholders.
    // Approximate using stop distance + volatility regime (ATR not available here).
    const entry = typeof r.entry_price === "number" ? r.entry_price : null;
    const stop = typeof r.stop_loss === "number" ? r.stop_loss : null;

    let stopPct = 0;
    if (entry && stop && entry > 0) {
      stopPct = (Math.abs(entry - stop) / entry) * 100;
    }

    // Base from stop distance (0–70).
    let score = Math.max(0, Math.min(70, stopPct * 8));

    // Volatility penalty.
    const vs = (r.volatility_state ?? "").toUpperCase();
    if (vs === "EXTREME") score += 25;
    else if (vs === "HIGH") score += 15;
    else if (vs === "NORMAL") score += 6;

    score = Math.max(0, Math.min(100, score));
    return Math.round(score);
  };

  const rankKey = (r: AiSignalRow | null) => {
    const ts = pickSignalTs(r);
    const conf = computeConfidenceScore(r) ?? -1;
    const risk = computeRiskScore(r) ?? 999;
    const updated = r?.updated_at ? new Date(r.updated_at).getTime() : 0;
    return { ts, conf, risk, updated };
  };

  const isBetter = (a: AiSignalRow, b: AiSignalRow): boolean => {
    const ka = rankKey(a);
    const kb = rankKey(b);

    // Primary: most recent
    if (ka.ts !== kb.ts) return ka.ts > kb.ts;
    // Secondary: confidence desc
    if (ka.conf !== kb.conf) return ka.conf > kb.conf;
    // Tertiary: risk asc (lower risk preferred)
    if (ka.risk !== kb.risk) return ka.risk < kb.risk;
    // Final: updated_at desc
    return ka.updated > kb.updated;
  };

  // One row per symbol: choose the top-ranked record deterministically.
  const bySymbol = new Map<string, AiSignalRow>();
  for (const row of (signalRows ?? []) as AiSignalRow[]) {
    const sym = (row.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;

    const current = bySymbol.get(sym);
    if (!current || isBetter(row, current)) {
      bySymbol.set(sym, row);
    }
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

  const items = symbols.map((symbol) => {
    const s = bySymbol.get(symbol) ?? null;
    const st = (s?.signal_type ?? "").toLowerCase();
    const signal = st.includes("buy") ? "BUY" : st.includes("sell") ? "SELL" : "—";

    const confidence_score = computeConfidenceScore(s);
    const risk_score = computeRiskScore(s);

    const signalTs = s?.signal_bar_ts ?? s?.updated_at ?? s?.created_at ?? null;

    return {
      symbol,
      signal,
      status: posMap.get(symbol) ?? null,

      // Legacy fields kept for existing clients
      confidence: confidence_score,
      risk: risk_score,

      // New explicit fields
      confidence_score,
      risk_score,

      entry: s?.entry_price ?? null,
      stop: s?.stop_loss ?? null,
      target: s?.take_profit_1 ?? null,
      signalTs,
    };
  });

  // Apply sort on the final list so it works for both modes.
  const sortedItems = items
    .slice()
    .sort((a, b) => {
      if (sort === "symbol") {
        return a.symbol.localeCompare(b.symbol);
      }
      // Default: confidence (nulls last)
      const ac = typeof a.confidence === "number" ? a.confidence : -1;
      const bc = typeof b.confidence === "number" ? b.confidence : -1;
      return bc - ac;
    });

  return json(request, {
    mode,
    total: universeTotal,
    asOf: new Date().toISOString(),
    window: { timezone: TIMEZONE, start: WINDOW_START, end: WINDOW_END },
    items: sortedItems,
  });
}
