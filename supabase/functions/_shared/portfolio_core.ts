import { getWhitelistedTickers, type WhitelistedTicker } from './whitelist.ts';

type FocusRow = {
  symbol: string;
  trade_date: string;
  trade_priority_score: number | null;
  rank: number | null;
  confidence: number | null;
  score_components?: Record<string, unknown> | null;
};

export type PortfolioCandidate = {
  symbol: string;
  is_top8: boolean;
  manual_priority: number;
  trade_priority_score: number;
  confidence: number;
  rank: number | null;
  trade_date: string | null;
};

export type PortfolioBucketGuard = {
  coreSymbols: Set<string>;
  exploreSymbols: Set<string>;
  coreSlots: number;
  exploreSlots: number;
  candidates: PortfolioCandidate[];
  snapshotDate: string | null;
  totalCandidates: number;
};

type BuildGuardOptions = {
  maxSlots: number;
  now?: Date;
};

export async function buildPortfolioBucketGuard(
  supabase: any,
  options: BuildGuardOptions,
): Promise<PortfolioBucketGuard | null> {
  const maxSlots = Math.max(0, options.maxSlots ?? 0);
  if (maxSlots === 0) return null;

  const whitelist = await getWhitelistedTickers(supabase);
  if (whitelist.length === 0) {
    console.warn('[portfolio_guard] Whitelist empty; skipping bucket guard');
    return null;
  }

  const now = options.now ?? new Date();
  const tradeDate = now.toISOString().slice(0, 10);
  const focusRows = await loadFocusRows(supabase, tradeDate);
  const focusMap = new Map<string, FocusRow>();
  for (const row of focusRows) {
    const symbol = normalizeSymbol(row.symbol);
    if (symbol) {
      focusMap.set(symbol, row);
    }
  }

  const candidates: PortfolioCandidate[] = whitelist.map((row) =>
    buildCandidate(row, focusMap.get(row.symbol))
  );

  const validCandidates = candidates
    .filter((c) => Number.isFinite(c.trade_priority_score))
    .sort(sortCandidates);

  if (validCandidates.length === 0) {
    console.warn('[portfolio_guard] No candidates after scoring; skipping bucket guard');
    return null;
  }

  const coreSlots = Math.max(1, Math.ceil(maxSlots * 0.8));
  const exploreSlots = Math.max(0, maxSlots - coreSlots);

  const coreSelection = new Set<string>();
  for (const candidate of validCandidates.slice(0, coreSlots)) {
    coreSelection.add(candidate.symbol);
  }

  const exploreCandidatesPool = validCandidates.filter(
    (candidate) => !candidate.is_top8 && !coreSelection.has(candidate.symbol),
  );
  const rotatedExploreSymbols = await rotateExploreSymbols(
    supabase,
    exploreCandidatesPool,
    exploreSlots,
  );

  const exploreSelection = new Set<string>(rotatedExploreSymbols);

  if (exploreSelection.size < exploreSlots) {
    for (const candidate of validCandidates) {
      if (coreSelection.has(candidate.symbol) || exploreSelection.has(candidate.symbol)) {
        continue;
      }
      exploreSelection.add(candidate.symbol);
      if (exploreSelection.size >= exploreSlots) break;
    }
  }

  return {
    coreSymbols: coreSelection,
    exploreSymbols: exploreSelection,
    coreSlots,
    exploreSlots,
    candidates: validCandidates,
    snapshotDate: focusRows[0]?.trade_date ?? null,
    totalCandidates: validCandidates.length,
  };
}

async function loadFocusRows(
  supabase: any,
  tradeDate: string,
): Promise<FocusRow[]> {
  const baseColumns = 'symbol, trade_date, trade_priority_score, rank, confidence, score_components';

  const { data: todayRows, error: todayError } = await supabase
    .from('daily_focus_tickers')
    .select(baseColumns)
    .eq('trade_date', tradeDate)
    .order('rank', { ascending: true });

  if (todayError) {
    console.warn('[portfolio_guard] Failed to load today focus rows:', todayError.message);
  }

  if (todayRows && todayRows.length > 0) {
    return todayRows as FocusRow[];
  }

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('daily_focus_tickers')
    .select(baseColumns)
    .order('trade_date', { ascending: false })
    .order('rank', { ascending: true })
    .limit(60);

  if (fallbackError) {
    console.warn('[portfolio_guard] Failed to load fallback focus rows:', fallbackError.message);
    return [];
  }

  return fallbackRows as FocusRow[] || [];
}

function buildCandidate(
  whitelistRow: WhitelistedTicker,
  focusRow?: FocusRow,
): PortfolioCandidate {
  const confidenceFromComponents = focusRow?.score_components
    ? getScoreComponent(focusRow.score_components, 'confidence')
    : null;
  const confidence = Number(focusRow?.confidence ?? extractNumber(confidenceFromComponents) ?? 0);
  const manualPriority = Number(whitelistRow.manual_priority ?? 0);
  const isTop8 = Boolean(whitelistRow.is_top8);
  const priorityScore = typeof focusRow?.trade_priority_score === 'number'
    ? Number(focusRow.trade_priority_score)
    : computePriorityScore(isTop8, manualPriority, confidence);

  return {
    symbol: whitelistRow.symbol,
    is_top8: isTop8,
    manual_priority: manualPriority,
    trade_priority_score: Number(priorityScore.toFixed(4)),
    confidence,
    rank: focusRow?.rank ?? null,
    trade_date: focusRow?.trade_date ?? null,
  };
}

function computePriorityScore(
  isTop8: boolean,
  manualPriority: number,
  confidence: number,
): number {
  const clampedManual = clamp(manualPriority, 0, 100);
  const clampedConfidence = clamp(confidence, 0, 100);
  return (isTop8 ? 30 : 0) + clampedManual * 0.4 + clampedConfidence * 0.1;
}

async function rotateExploreSymbols(
  supabase: any,
  pool: PortfolioCandidate[],
  desired: number,
): Promise<string[]> {
  if (desired === 0 || pool.length === 0) {
    return [];
  }

  const normalizedPool = pool.map((candidate) => candidate.symbol);
  const { data: stateRow, error } = await supabase
    .from('exploration_state')
    .select('id, last_symbol')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.warn('[portfolio_guard] Failed to load exploration_state:', error.message);
  }

  const lastSymbol = normalizeSymbol(stateRow?.last_symbol || '');
  let startIdx = 0;
  if (lastSymbol) {
    const foundIdx = normalizedPool.findIndex((symbol) => symbol === lastSymbol);
    if (foundIdx >= 0) {
      startIdx = (foundIdx + 1) % normalizedPool.length;
    }
  }

  const picks: string[] = [];
  let idx = startIdx;
  const visited = new Set<number>();

  while (picks.length < desired && visited.size < normalizedPool.length) {
    const symbol = normalizedPool[idx];
    if (!picks.includes(symbol)) {
      picks.push(symbol);
    }
    visited.add(idx);
    idx = (idx + 1) % normalizedPool.length;
  }

  if (picks.length > 0) {
    await supabase
      .from('exploration_state')
      .upsert(
        {
          id: 1,
          last_symbol: picks[picks.length - 1],
        },
        { onConflict: 'id' },
      );
  }

  return picks;
}

function sortCandidates(a: PortfolioCandidate, b: PortfolioCandidate): number {
  if (b.trade_priority_score !== a.trade_priority_score) {
    return b.trade_priority_score - a.trade_priority_score;
  }
  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }
  return a.symbol.localeCompare(b.symbol);
}

function normalizeSymbol(symbol: string | null | undefined): string {
  return (symbol || '').trim().toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function extractNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getScoreComponent(
  components: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!components || typeof components !== 'object') {
    return null;
  }
  return (components as Record<string, unknown>)[key];
}
