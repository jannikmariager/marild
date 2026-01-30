/**
 * Engine Allocation Scoring & Promotion Job (daily cron)
 *
 * Responsibilities:
 *  - Compute 30d & 60d metrics per (symbol, engine) from SHADOW engine_trades
 *  - Persist risk-aware scores into engine_ticker_score_history
 *  - Evaluate promotions using sticky ownership, cooldowns, and feature flags
 *  - Queue pending promotions when live positions are open
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  computeAllocationMetrics,
  computeAllocationScore,
  fetchTickerOwners,
  getOwnerOrBaseline,
  isSymbolAllowlisted,
  loadAllocationFlags,
  meetsPromotionDelta,
} from "../_shared/engine_allocation.ts";

type Trade = {
  symbol: string;
  engine_key: string;
  engine_version: string;
  closed_at: string;
  realized_r: number | null;
};

type ScoreRow = {
  symbol: string;
  engine_key: string;
  engine_version: string;
  window_days: number;
  trades: number;
  expectancy_r: number;
  max_dd_r: number;
  stability: number;
  win_rate: number;
  profit_factor: number;
  score: number;
  eligible: boolean;
  reason: string | null;
};

type Proposal = {
  symbol: string;
  ownerKey: string;
  ownerVersion: string;
  ownerScore: number;
  ownerExpectancy: number;
  candidate: ScoreRow;
};

const PARTICIPATING_ENGINES = [
  "SWING_V2_ROBUST",
  "SWING_V1_12_15DEC",
  "SCALP_V1_MICROEDGE",
  "CRYPTO_V1_SHADOW",
  "SWING_FAV8_SHADOW",
];

const WINDOWS = [30, 60];
const PROMO_WINDOW = 60;
const MIN_TRADES = 20;
const EXPECTANCY_FLOOR = -0.2; // -0.20 R
const MAX_DD_LIMIT_R = 5;
const COOLDOWN_DAYS = 45; // calendar days (~30 trading days)
const SCORE_MULTIPLIER = 1.2;
const EXPECTANCY_DELTA = 0.1;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async () => {
  try {
    const now = new Date();
    const lookbackDays = Math.max(...WINDOWS);
    const fromDate = new Date(
      now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
    );

    const flags = await loadAllocationFlags(supabase);
    const trades = await fetchTrades(fromDate);
    const grouped = groupTrades(trades);

    const scoreRows: ScoreRow[] = [];

    for (const [key, tradeList] of grouped.entries()) {
      const [symbol, engineKey, engineVersion] = key.split("|");
      for (const window of WINDOWS) {
        const windowFrom = new Date(
          now.getTime() - window * 24 * 60 * 60 * 1000,
        );
        const windowTrades = tradeList.filter((t) =>
          new Date(t.closed_at) >= windowFrom
        );
        const metrics = computeAllocationMetrics(windowTrades);
        const eligible = metrics.trades >= MIN_TRADES &&
          metrics.maxDdR <= MAX_DD_LIMIT_R &&
          metrics.expectancyR >= EXPECTANCY_FLOOR;
        let reason: string | null = null;
        if (!eligible) {
          if (metrics.trades < MIN_TRADES) reason = "min_trades";
          else if (metrics.maxDdR > MAX_DD_LIMIT_R) reason = "max_dd";
          else if (metrics.expectancyR < EXPECTANCY_FLOOR) {
            reason = "expectancy_floor";
          }
        }
        const score = computeAllocationScore(metrics);
        scoreRows.push({
          symbol,
          engine_key: engineKey,
          engine_version: engineVersion,
          window_days: window,
          trades: metrics.trades,
          expectancy_r: metrics.expectancyR,
          max_dd_r: metrics.maxDdR,
          stability: metrics.stability,
          win_rate: metrics.winRate,
          profit_factor: metrics.profitFactor,
          score,
          eligible,
          reason,
        });
      }
    }

    if (scoreRows.length > 0) {
      const { error } = await supabase
        .from("engine_ticker_score_history")
        .insert(scoreRows);
      if (error) throw error;
    }

    const promoRows = scoreRows.filter((row) => row.window_days === PROMO_WINDOW);
    const symbols = Array.from(new Set(promoRows.map((row) => row.symbol)));
    const owners = await fetchTickerOwners(supabase, symbols);
    const engineUniverse = await fetchEngineUniverseMap(symbols);
    const openTickers = await fetchOpenLiveTickers(symbols);

    const proposals = buildProposals(promoRows, owners, engineUniverse);
    await applyProposals(proposals, {
      owners,
      flags,
      openTickers,
      now,
    });

    return new Response(
      JSON.stringify({
        status: "ok",
        scores: scoreRows.length,
        proposals: proposals.length,
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error("[engine_allocation_scoring] error", err);
    return new Response(
      JSON.stringify({ status: "error", message: String(err) }),
      { status: 500 },
    );
  }
});

async function fetchTrades(fromDate: Date): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("engine_trades")
    .select("ticker, engine_key, engine_version, closed_at, realized_r, run_mode")
    .gte("closed_at", fromDate.toISOString())
    .eq("run_mode", "SHADOW")
    .in("engine_key", PARTICIPATING_ENGINES);
  if (error) throw error;
  return (data || []).map((t: any) => ({
    symbol: t.ticker,
    engine_key: t.engine_key,
    engine_version: t.engine_version,
    closed_at: t.closed_at,
    realized_r: t.realized_r ?? t.realized_pnl_r ?? 0,
  }));
}

function groupTrades(trades: Trade[]): Map<string, Trade[]> {
  const grouped = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = `${trade.symbol}|${trade.engine_key}|${trade.engine_version}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(trade);
  }
  return grouped;
}

function buildProposals(
  scores: ScoreRow[],
  owners: Map<string, any>,
  universe: Map<string, Set<string>>,
): Proposal[] {
  const bySymbol = new Map<string, ScoreRow[]>();
  for (const row of scores) {
    if (!isEngineAllowed(universe, row.symbol, row.engine_key)) continue;
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
    bySymbol.get(row.symbol)!.push(row);
  }

  const proposals: Proposal[] = [];

  for (const [symbol, rows] of bySymbol.entries()) {
    const owner = getOwnerOrBaseline(owners, symbol);
    const ownerRow = rows.find((row) =>
      row.engine_key === owner.active_engine_key &&
      row.engine_version === owner.active_engine_version
    );
    const ownerScore = ownerRow?.score ?? 0;
    const ownerExpectancy = ownerRow?.expectancy_r ?? 0;

    const candidates = rows
      .filter((row) => row.eligible)
      .sort((a, b) => Number(b.score) - Number(a.score));

    const best = candidates.find((row) =>
      row.engine_key !== owner.active_engine_key ||
      row.engine_version !== owner.active_engine_version
    );

    if (!best) continue;

    proposals.push({
      symbol,
      ownerKey: owner.active_engine_key,
      ownerVersion: owner.active_engine_version,
      ownerScore,
      ownerExpectancy,
      candidate: best,
    });
  }

  return proposals;
}

async function applyProposals(
  proposals: Proposal[],
  opts: {
    owners: Map<string, any>;
    flags: Awaited<ReturnType<typeof loadAllocationFlags>>;
    openTickers: Set<string>;
    now: Date;
  },
) {
  if (proposals.length === 0) return;

  for (const proposal of proposals) {
    const ownerRow = opts.owners.get(proposal.symbol);
    const lockedUntil = ownerRow?.locked_until
      ? new Date(ownerRow.locked_until)
      : new Date(0);

    const allowlisted = isSymbolAllowlisted(opts.flags, proposal.symbol);
    const cooldownOk = opts.now > lockedUntil;
    const deltaOk = meetsPromotionDelta(
      proposal.ownerScore,
      proposal.ownerExpectancy,
      proposal.candidate.score,
      proposal.candidate.expectancy_r,
      SCORE_MULTIPLIER,
      EXPECTANCY_DELTA,
    );
    const eligible = proposal.candidate.eligible;
    const hasOpenPosition = opts.openTickers.has(proposal.symbol.toUpperCase());

    let reason = "proposal_only";
    let pendingReason: string | null = null;
    let apply = false;

    if (!opts.flags.enabled) reason = "flag_disabled";
    else if (!allowlisted) reason = "allowlist_skip";
    else if (!eligible) reason = proposal.candidate.reason ?? "not_eligible";
    else if (!deltaOk) reason = "delta_threshold";
    else if (!cooldownOk) reason = "locked";
    else if (hasOpenPosition) {
      reason = "pending_position";
      pendingReason = "PENDING_OPEN_POSITION";
    } else {
      apply = true;
      reason = "auto_promotion";
    }

    const decisionMode = opts.flags.enabled ? "AUTO" : "AUTO_DISABLED";
    const newLockUntil = new Date(
      opts.now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    await supabase.from("promotion_log").insert({
      symbol: proposal.symbol,
      from_engine_key: proposal.ownerKey,
      to_engine_key: proposal.candidate.engine_key,
      from_version: proposal.ownerVersion,
      to_version: proposal.candidate.engine_version,
      old_score: proposal.ownerScore,
      new_score: proposal.candidate.score,
      delta: proposal.candidate.score - proposal.ownerScore,
      reason,
      pending_reason: pendingReason,
      locked_until: apply ? newLockUntil : ownerRow?.locked_until ?? null,
      decision_mode: decisionMode,
      applied: apply,
    });

    if (apply) {
      const { error } = await supabase.from("ticker_engine_owner").upsert({
        symbol: proposal.symbol,
        active_engine_key: proposal.candidate.engine_key,
        active_engine_version: proposal.candidate.engine_version,
        last_score: proposal.candidate.score,
        last_promotion_at: opts.now.toISOString(),
        locked_until: newLockUntil,
        updated_at: opts.now.toISOString(),
      });
      if (error) throw error;
    }
  }
}

async function fetchEngineUniverseMap(
  symbols: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (symbols.length === 0) return map;

  const { data, error } = await supabase
    .from("engine_universe")
    .select("symbol, engine_key, enabled")
    .in("symbol", symbols);
  if (error) throw error;

  for (const row of data || []) {
    if (!map.has(row.symbol)) map.set(row.symbol, new Set<string>());
    if (row.enabled !== false) {
      map.get(row.symbol)!.add(row.engine_key);
    }
  }

  return map;
}

function isEngineAllowed(
  universe: Map<string, Set<string>>,
  symbol: string,
  engineKey: string,
): boolean {
  const set = universe.get(symbol);
  if (!set || set.size === 0) return true;
  return set.has(engineKey);
}

async function fetchOpenLiveTickers(
  symbols: string[],
): Promise<Set<string>> {
  const set = new Set<string>();
  if (symbols.length === 0) return set;
  const { data, error } = await supabase
    .from("live_positions")
    .select("ticker")
    .in("ticker", symbols);
  if (error) throw error;
  for (const row of data || []) {
    if (row.ticker) set.add(row.ticker.toUpperCase());
  }
  return set;
}
