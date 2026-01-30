import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

type SupabaseClient = ReturnType<typeof createClient>;

export const BASELINE_ENGINE_KEY = "SWING";
export const BASELINE_ENGINE_VERSION = "BASELINE";

export type AllocationFlags = {
  enabled: boolean;
  allowlist: Set<string>;
};

export type TickerOwnerRow = {
  symbol: string;
  active_engine_key: string;
  active_engine_version: string;
  locked_until?: string | null;
  last_score?: number | null;
  last_promotion_at?: string | null;
};

export type AllocationTrade = {
  closed_at: string;
  realized_r: number | null;
};

export type AllocationMetrics = {
  trades: number;
  expectancyR: number;
  maxDdR: number;
  stability: number;
  winRate: number;
  profitFactor: number;
};

const FLAG_ENABLED_KEY = "engine_allocation_enabled";
const FLAG_ALLOWLIST_KEY = "engine_allocation_symbol_allowlist";

export async function loadAllocationFlags(
  supabase: SupabaseClient,
): Promise<AllocationFlags> {
  try {
    const { data, error } = await supabase
      .from("app_feature_flags")
      .select("key, bool_value, text_array_value")
      .in("key", [FLAG_ENABLED_KEY, FLAG_ALLOWLIST_KEY]);

    if (error) throw error;

    let enabled = false;
    const allowlist = new Set<string>();

    for (const row of data || []) {
      if (row.key === FLAG_ENABLED_KEY) {
        enabled = Boolean(row.bool_value);
      } else if (
        row.key === FLAG_ALLOWLIST_KEY && Array.isArray(row.text_array_value)
      ) {
        for (const symbol of row.text_array_value as string[]) {
          allowlist.add(symbol.toUpperCase());
        }
      }
    }

    return { enabled, allowlist };
  } catch (err) {
    console.warn(
      "[allocation] Failed to load feature flags; defaulting to disabled",
      err?.message ?? err,
    );
    return { enabled: false, allowlist: new Set() };
  }
}

export function isSymbolAllowlisted(
  flags: AllocationFlags,
  ticker: string,
): boolean {
  if (!flags.enabled) return false;
  if (!ticker) return false;
  if (flags.allowlist.size === 0) return true;
  return flags.allowlist.has(ticker.toUpperCase());
}

export async function fetchTickerOwners(
  supabase: SupabaseClient,
  symbols: string[],
): Promise<Map<string, TickerOwnerRow>> {
  const owners = new Map<string, TickerOwnerRow>();
  if (!symbols || symbols.length === 0) return owners;

  try {
    const { data, error } = await supabase
      .from("ticker_engine_owner")
      .select(
        "symbol, active_engine_key, active_engine_version, locked_until, last_score, last_promotion_at",
      )
      .in("symbol", symbols.map((s) => s.toUpperCase()));

    if (error) throw error;

    for (const row of data || []) {
      owners.set(row.symbol, {
        symbol: row.symbol,
        active_engine_key: row.active_engine_key || BASELINE_ENGINE_KEY,
        active_engine_version: row.active_engine_version ||
          BASELINE_ENGINE_VERSION,
        locked_until: row.locked_until,
        last_score: row.last_score,
        last_promotion_at: row.last_promotion_at,
      });
    }
  } catch (err) {
    console.warn("[allocation] Failed to load ticker owners:", err?.message ?? err);
  }

  return owners;
}

export function getOwnerOrBaseline(
  owners: Map<string, TickerOwnerRow>,
  symbol: string,
): TickerOwnerRow {
  return owners.get(symbol) ?? {
    symbol,
    active_engine_key: BASELINE_ENGINE_KEY,
    active_engine_version: BASELINE_ENGINE_VERSION,
  };
}

export function computeAllocationMetrics(
  trades: AllocationTrade[],
): AllocationMetrics {
  const n = trades.length;
  if (n === 0) {
    return {
      trades: 0,
      expectancyR: 0,
      maxDdR: 0,
      stability: 0,
      winRate: 0,
      profitFactor: 0,
    };
  }

  const rs = trades.map((t) => Number(t.realized_r ?? 0));
  const expectancy = rs.reduce((sum, r) => sum + r, 0) / n;

  let peak = 0;
  let dd = 0;
  let cum = 0;
  for (const r of rs) {
    cum += r;
    if (cum > peak) peak = cum;
    const drawdown = peak - cum;
    if (drawdown > dd) dd = drawdown;
  }

  const mean = expectancy;
  const variance = rs.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
  const stdev = Math.sqrt(variance);

  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r, 0));
  const profitFactor = grossLoss === 0
    ? (grossWin > 0 ? Number.POSITIVE_INFINITY : 0)
    : grossWin / grossLoss;

  return {
    trades: n,
    expectancyR: expectancy,
    maxDdR: dd,
    stability: isFinite(stdev) ? stdev : 0,
    winRate: (wins.length / n) * 100,
    profitFactor,
  };
}

export function computeAllocationScore(metrics: AllocationMetrics): number {
  if (metrics.trades === 0) return 0;
  return (metrics.expectancyR * 100) - (metrics.maxDdR * 50) -
    (metrics.stability * 10);
}

export function meetsPromotionDelta(
  currentScore: number,
  currentExpectancy: number,
  candidateScore: number,
  candidateExpectancy: number,
  scoreMultiplier = 1.2,
  expectancyDelta = 0.1,
): boolean {
  if (candidateScore >= currentScore * scoreMultiplier) return true;
  if (candidateExpectancy >= currentExpectancy + expectancyDelta) return true;
  return false;
}
