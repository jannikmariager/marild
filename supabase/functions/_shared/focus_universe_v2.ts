import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { FocusConfig, getFocusConfig, FocusVolatilityGateMode } from "./config.ts";

type SupabaseClient = ReturnType<typeof createClient>;

export type FocusLane = "primary" | "momentum" | "fallback" | "missed";

export interface FocusTicker {
  ticker: string;
  confidence: number;
  signalId: string | null;
  signalCreatedAt: string | null;
  lane: FocusLane;
  volatilityGate?: {
    mode: FocusVolatilityGateMode;
    passed: boolean;
    reason: string;
    atrPercentile?: number | null;
  };
}

export interface MissedTicker {
  ticker: string;
  confidence: number;
  signalId: string | null;
  signalCreatedAt: string | null;
  reason: string;
}

export interface FocusUniverseResult {
  runId: string;
  generatedAt: string;
  lookbackHours: number;
  primary: FocusTicker[];
  momentum: FocusTicker[];
  fallback: FocusTicker[];
  final: string[];
  missedByThreshold: MissedTicker[];
  stats: {
    universeSize: number;
    signalsConsidered: number;
    primaryCount: number;
    momentumCount: number;
    fallbackCount: number;
  };
}

interface SignalRow {
  id: string;
  symbol: string;
  confidence_score: number;
  created_at: string;
}

export async function buildFocusUniverseV2(opts: {
  supabase: SupabaseClient;
  universeTickers: string[];
  now?: Date;
  config?: FocusConfig;
}): Promise<FocusUniverseResult> {
  const {
    supabase,
    universeTickers,
    now = new Date(),
    config = getFocusConfig(),
  } = opts;

  const runId = crypto.randomUUID();
  const generatedAt = now.toISOString();

  const lookbackFrom = new Date(now.getTime() - config.lookbackHours * 60 * 60 * 1000);

  // Fetch latest signals per ticker within lookback
  const { data: signalsData, error: signalsError } = await supabase
    .from("ai_signals")
    .select("id, symbol, confidence_score, created_at")
    .in("symbol", universeTickers)
    .gte("created_at", lookbackFrom.toISOString())
    .order("created_at", { ascending: false });

  if (signalsError) {
    throw signalsError;
  }

  const latestByTicker = new Map<string, SignalRow>();
  for (const row of signalsData || []) {
    if (!latestByTicker.has(row.symbol)) {
      latestByTicker.set(row.symbol, row as SignalRow);
    }
  }

  const signals = Array.from(latestByTicker.values());

  const primary = signals
    .filter((s) => s.confidence_score >= config.primaryMinConf)
    .sort(sortByConfidenceThenTime)
    .map((s) => toFocusTicker(s, "primary"));

  const momentumCandidates = signals.filter(
    (s) =>
      s.confidence_score >= config.momentumMinConf &&
      s.confidence_score <= config.momentumMaxConf &&
      s.confidence_score < config.primaryMinConf,
  );

  const momentum: FocusTicker[] = [];
  for (const s of momentumCandidates.sort(sortByConfidenceThenTime)) {
    const gate = await evaluateVolatilityGate(s.symbol, config);
    if (gate.passed) {
      momentum.push({
        ...toFocusTicker(s, "momentum"),
        volatilityGate: gate,
      });
    }
  }

  const selectedTickers = new Set<string>([
    ...primary.map((t) => t.ticker),
    ...momentum.map((t) => t.ticker),
  ]);

  // Fallback fill
  const remaining = signals
    .filter((s) => !selectedTickers.has(s.symbol))
    .sort(sortByConfidenceThenTime);
  const fallback: FocusTicker[] = [];
  for (const s of remaining) {
    if (
      primary.length + momentum.length + fallback.length >= config.maxTickers
    ) {
      break;
    }
    if (primary.length + momentum.length + fallback.length < config.minFocusSize) {
      fallback.push(toFocusTicker(s, "fallback"));
      selectedTickers.add(s.symbol);
    }
  }

  const finalTickers = [
    ...primary,
    ...momentum,
    ...fallback,
  ]
    .slice(0, config.maxTickers)
    .map((t) => t.ticker);

  // Missed list: just below primary threshold
  const missedLower = config.primaryMinConf - 10;
  const missed = signals
    .filter(
      (s) =>
        s.confidence_score < config.primaryMinConf &&
        s.confidence_score >= missedLower,
    )
    .sort(sortByConfidenceThenTime)
    .slice(0, config.missedListSize)
    .map((s) => ({
      ticker: s.symbol,
      confidence: s.confidence_score,
      signalId: s.id,
      signalCreatedAt: s.created_at,
      reason: "below_primary_min",
    }));

  const result: FocusUniverseResult = {
    runId,
    generatedAt,
    lookbackHours: config.lookbackHours,
    primary,
    momentum,
    fallback,
    final: finalTickers,
    missedByThreshold: missed,
    stats: {
      universeSize: universeTickers.length,
      signalsConsidered: signals.length,
      primaryCount: primary.length,
      momentumCount: momentum.length,
      fallbackCount: fallback.length,
    },
  };

  if (config.enableVerboseLogs) {
    console.log(
      JSON.stringify(
        {
          event: "focus_universe_v2",
          runId,
          generatedAt,
          thresholds: {
            primary: config.primaryMinConf,
            momentum: [config.momentumMinConf, config.momentumMaxConf],
            lookbackHours: config.lookbackHours,
          },
          counts: result.stats,
          primary: primary.map((p) => ({ t: p.ticker, c: p.confidence })),
          momentum: momentum.map((p) => ({
            t: p.ticker,
            c: p.confidence,
            gate: p.volatilityGate,
          })),
          fallback: fallback.map((f) => ({ t: f.ticker, c: f.confidence })),
          missed: missed.map((m) => ({ t: m.ticker, c: m.confidence })),
        },
        null,
        2,
      ),
    );
  }

  if (config.enableDbAudit) {
    await persistAudit(supabase, result, config);
  }

  return result;
}

function sortByConfidenceThenTime(a: SignalRow, b: SignalRow) {
  if (b.confidence_score === a.confidence_score) {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }
  return b.confidence_score - a.confidence_score;
}

function toFocusTicker(s: SignalRow, lane: FocusLane): FocusTicker {
  return {
    ticker: s.symbol,
    confidence: s.confidence_score,
    signalId: s.id,
    signalCreatedAt: s.created_at,
    lane,
  };
}

async function evaluateVolatilityGate(ticker: string, config: FocusConfig) {
  const upperTicker = ticker.toUpperCase();
  const inList = config.volatilityTickerList.includes(upperTicker);

  const buildResult = (
    passed: boolean,
    reason: string,
    atrPercentile: number | null = null,
  ) => ({
    mode: config.volatilityGateMode,
    passed,
    reason,
    atrPercentile,
  });

  if (config.volatilityGateMode === "LIST") {
    return buildResult(inList, inList ? "list_match" : "not_in_list");
  }

  // ATR placeholder: ATR data not available in current schema; fallback to list
  const atrPercentile: number | null = null;
  const atrAvailable = false;

  if (config.volatilityGateMode === "ATR_PCT") {
    return buildResult(
      false,
      "atr_unavailable",
      atrPercentile,
    );
  }

  // HYBRID
  if (!atrAvailable) {
    return buildResult(
      inList,
      inList ? "atr_unavailable_fallback_list_pass" : "atr_unavailable_fallback_list_fail",
      atrPercentile,
    );
  }

  return buildResult(false, "not_implemented");
}

async function persistAudit(
  supabase: SupabaseClient,
  result: FocusUniverseResult,
  config: FocusConfig,
) {
  const { error: runErr, data: runInsert } = await supabase
    .from("focus_universe_runs")
    .insert({
      id: result.runId,
      lookback_hours: result.lookbackHours,
      config,
      stats: result.stats,
      final_tickers: result.final,
    })
    .select("id")
    .single();

  if (runErr) {
    console.warn("[focus_universe_v2] audit run insert failed", runErr);
    return;
  }

  const items = [
    ...result.primary,
    ...result.momentum,
    ...result.fallback,
  ].map((t) => ({
    run_id: result.runId,
    ticker: t.ticker,
    lane: t.lane,
    confidence: t.confidence,
    signal_id: t.signalId,
    signal_created_at: t.signalCreatedAt,
    volatility_gate: t.volatilityGate ?? null,
    reason: null,
  }));

  const missedItems = result.missedByThreshold.map((m) => ({
    run_id: result.runId,
    ticker: m.ticker,
    lane: "missed",
    confidence: m.confidence,
    signal_id: m.signalId,
    signal_created_at: m.signalCreatedAt,
    volatility_gate: null,
    reason: m.reason,
  }));

  const { error: itemsErr } = await supabase
    .from("focus_universe_run_items")
    .insert([...items, ...missedItems]);

  if (itemsErr) {
    console.warn("[focus_universe_v2] audit items insert failed", itemsErr);
  }
}
