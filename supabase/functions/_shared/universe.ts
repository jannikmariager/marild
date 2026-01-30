import {
  type AllocationFlags,
  type TickerOwnerRow,
  fetchTickerOwners,
  getOwnerOrBaseline,
  isSymbolAllowlisted,
  loadAllocationFlags,
} from "./engine_allocation.ts";
import { getWhitelistedTickers } from "./whitelist.ts";

export type AllocationContext = {
  flags: AllocationFlags;
  owners: Map<string, TickerOwnerRow>;
};

export type SwingUniverse = {
  focusSymbols: Set<string> | null;
  allowlistSymbols: string[];
  allocationCtx: AllocationContext | null;
};

export async function loadFocusSymbols(
  supabase: any,
): Promise<Set<string> | null> {
  const { data: focusTickers, error: focusError } = await supabase
    .from("daily_focus_tickers")
    .select("symbol")
    .order("rank", { ascending: true });

  if (focusError) {
    console.error("[universe] Failed to load focus tickers:", focusError);
    return null;
  }

  if (!focusTickers || focusTickers.length === 0) {
    return null;
  }

  return new Set(
    focusTickers
      .map((row: { symbol: string }) => (row.symbol || "").toUpperCase())
      .filter((symbol: string) => Boolean(symbol)),
  );
}

export async function buildAllocationContext(
  supabase: any,
  focusSymbols: Set<string> | null,
): Promise<AllocationContext | null> {
  const flags = await loadAllocationFlags(supabase);
  const shouldLoadOwners = flags.enabled || flags.allowlist.size > 0;
  if (!shouldLoadOwners) {
    return {
      flags,
      owners: new Map(),
    };
  }

  const symbols = focusSymbols ? Array.from(focusSymbols) : [];
  const owners = symbols.length > 0
    ? await fetchTickerOwners(supabase, symbols)
    : new Map<string, TickerOwnerRow>();

  return { flags, owners };
}

/**
 * @deprecated Focus/allowlist universe is being replaced by ticker_whitelist.
 * This shim now resolves to the whitelist to minimize code churn until full migration.
 */
export async function getLiveSwingUniverse(
  supabase: any,
): Promise<SwingUniverse> {
  const whitelist = await getWhitelistedTickers(supabase);
  const focusSymbols = whitelist.length > 0
    ? new Set(whitelist.map((row) => row.symbol))
    : null;

  const allocationCtx = await buildAllocationContext(supabase, focusSymbols);
  const allowlistSymbols = [] as string[];

  return { focusSymbols, allowlistSymbols, allocationCtx };
}

export function assertUniverseMatchesLive(
  liveUniverse: SwingUniverse,
  candidateSymbols: string[],
): { matches: boolean; missing: string[] } {
  const liveSet = new Set<string>();

  if (liveUniverse.focusSymbols) {
    for (const symbol of liveUniverse.focusSymbols) {
      liveSet.add(symbol);
    }
  }
  for (const symbol of liveUniverse.allowlistSymbols) {
    liveSet.add(symbol);
  }

  const missing = candidateSymbols
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => !liveSet.has(symbol));

  return {
    matches: missing.length === 0,
    missing,
  };
}

export function resolveEngineRouting(
  allocationCtx: AllocationContext | null,
  ticker: string,
  fallbackKey: string,
  fallbackVersion: string,
): { engine_key: string; engine_version: string; enforced: boolean } {
  if (!allocationCtx || !ticker) {
    return { engine_key: fallbackKey, engine_version: fallbackVersion, enforced: false };
  }
  const allowed = isSymbolAllowlisted(allocationCtx.flags, ticker);
  if (!allowed) {
    return { engine_key: fallbackKey, engine_version: fallbackVersion, enforced: false };
  }
  const owner = getOwnerOrBaseline(allocationCtx.owners, ticker.toUpperCase());
  return {
    engine_key: owner.active_engine_key || fallbackKey,
    engine_version: owner.active_engine_version || fallbackVersion,
    enforced: true,
  };
}
