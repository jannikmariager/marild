// @ts-nocheck
import { fetchBulkQuotes } from "../_shared/yahoo_v8_client.ts";
import { fetchSignalsWithAllowlist } from "../_shared/signals.ts";
import {
  getLiveSwingUniverse,
  assertUniverseMatchesLive,
} from "../_shared/universe.ts";
import { getLiveStartingEquity } from "../_shared/portfolio.ts";

const ENGINE_KEY = "QUICK_PROFIT";
const ENGINE_VERSION = "QUICK_PROFIT_V1";
const RUN_MODE = "SHADOW";

const CONFIG = {
  beTriggerUsd: Number(Deno.env.get("QUICK_PROFIT_BE_TRIGGER_USD") ?? 150),
  partialTriggerUsd: Number(Deno.env.get("QUICK_PROFIT_PARTIAL_TRIGGER_USD") ?? 250),
  partialFraction: Number(Deno.env.get("QUICK_PROFIT_PARTIAL_FRACTION") ?? 0.5),
  trailDistanceUsd: Number(Deno.env.get("QUICK_PROFIT_TRAIL_DISTANCE_USD") ?? 120),
  beBufferUsd: Number(Deno.env.get("QUICK_PROFIT_BE_BUFFER_USD") ?? 5),
  lookbackHours: Number(Deno.env.get("QUICK_PROFIT_LOOKBACK_HOURS") ?? 2),
  maxConcurrentPositions: Number(Deno.env.get("QUICK_PROFIT_MAX_POSITIONS") ?? 10),
  riskPerTradePct: Number(Deno.env.get("QUICK_PROFIT_RISK_PCT") ?? 0.0075),
  maxNotionalPerPositionPct: Number(Deno.env.get("QUICK_PROFIT_MAX_NOTIONAL_PCT") ?? 0.25),
  maxPortfolioAllocationPct: Number(Deno.env.get("QUICK_PROFIT_MAX_PORTFOLIO_PCT") ?? 0.8),
  minPositionNotional: Number(Deno.env.get("QUICK_PROFIT_MIN_NOTIONAL") ?? 1000),
};

const ALLOWED_WRITE_TABLES = new Set([
  "engine_portfolios",
  "engine_positions",
  "engine_trades",
  "live_signal_decision_log", // shared decision log with run_mode tagging
]);

type QuickProfitState = {
  startingEquity: number;
  equity_dollars: number;
  cash_dollars: number;
  allocated_notional: number;
  open_positions_count: number;
  unrealized_pnl_dollars: number;
  realized_before: number;
  realized_delta: number;
};

type QuickProfitPosition = {
  id: string;
  ticker: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  qty: number;
  notional_at_entry: number;
  opened_at: string;
  side: "LONG" | "SHORT";
  be_activated_at: string | null;
  partial_taken: boolean;
  trail_active: boolean;
  trail_peak_pnl: number | null;
  trail_stop_price: number | null;
  management_meta: Record<string, unknown> | null;
  status: string;
};

function guardShadowWrite(table: string) {
  if (!ALLOWED_WRITE_TABLES.has(table)) {
    throw new Error(`[quick_profit] disallowed write to table ${table}`);
  }
}

export async function runQuickProfitTick({
  supabase,
  nowUtc,
}: {
  supabase: any;
  nowUtc: Date;
}) {
  const enabled = await isQuickProfitEnabled(supabase);
  if (!enabled) {
    console.log("[quick_profit] Engine disabled, skipping.");
    return;
  }

  const universe = await getLiveSwingUniverse(supabase);
  const allowedSymbols = buildAllowedSymbols(universe);
  const { matches, missing } = assertUniverseMatchesLive(universe, allowedSymbols);
  if (!matches && missing.length > 0) {
    console.warn(
      "[quick_profit] Universe mismatch detected. Missing symbols:",
      missing.join(", "),
    );
  }

  const portfolio = await ensureQuickProfitPortfolio(supabase, nowUtc);
  const { positions, state, tickerPriceMap } = await loadQuickProfitState(
    supabase,
    portfolio,
  );

  await manageOpenPositions({
    supabase,
    positions,
    state,
    tickerPriceMap,
    nowUtc,
  });

  await processQuickProfitSignals({
    supabase,
    state,
    allowedSymbols,
    nowUtc,
    existingTickers: new Set(
      positions
        .filter((p) => p.status !== "CLOSED")
        .map((p) => p.ticker),
    ),
  });

  await persistPortfolioSnapshot({ supabase, state, portfolio, nowUtc });
}

async function isQuickProfitEnabled(supabase: any): Promise<boolean> {
  const { data, error } = await supabase
    .from("engine_versions")
    .select("is_enabled, stopped_at")
    .eq("engine_key", ENGINE_KEY)
    .eq("engine_version", ENGINE_VERSION)
    .eq("run_mode", RUN_MODE)
    .maybeSingle();

  if (error) {
    console.warn("[quick_profit] Failed to load engine_versions:", error);
    return false;
  }

  if (!data) return false;
  return Boolean(data.is_enabled) && !data.stopped_at;
}

async function ensureQuickProfitPortfolio(supabase: any, nowUtc: Date) {
  const { data, error } = await supabase
    .from("engine_portfolios")
    .select("*")
    .eq("engine_key", ENGINE_KEY)
    .eq("engine_version", ENGINE_VERSION)
    .eq("run_mode", RUN_MODE)
    .maybeSingle();

  if (error) {
    throw new Error(`[quick_profit] Failed to load portfolio: ${error.message}`);
  }

  if (data) {
    return data;
  }

  const liveEquity = await getLiveStartingEquity(supabase, "SWING");
  guardShadowWrite("engine_portfolios");
  const { data: inserted, error: insertError } = await supabase
    .from("engine_portfolios")
    .insert({
      engine_key: ENGINE_KEY,
      engine_version: ENGINE_VERSION,
      run_mode: RUN_MODE,
      starting_equity: liveEquity,
      equity: liveEquity,
      allocated_notional: 0,
      created_at: nowUtc.toISOString(),
      updated_at: nowUtc.toISOString(),
    })
    .select("*")
    .maybeSingle();

  if (insertError) {
    throw new Error(`[quick_profit] Failed to init portfolio: ${insertError.message}`);
  }

  console.log(
    `[quick_profit] Initialized portfolio at live equity baseline $${liveEquity.toFixed(
      2,
    )}`,
  );
  return inserted;
}

function buildAllowedSymbols(universe: {
  focusSymbols: Set<string> | null;
  allowlistSymbols: string[];
}): string[] {
  const allowed = new Set<string>();
  if (universe.focusSymbols) {
    for (const ticker of universe.focusSymbols) {
      allowed.add(ticker.toUpperCase());
    }
  }
  for (const ticker of universe.allowlistSymbols || []) {
    allowed.add((ticker || "").toUpperCase());
  }
  return Array.from(allowed);
}

async function loadQuickProfitState(supabase: any, portfolio: any) {
  const { data: openPositions, error } = await supabase
    .from("engine_positions")
    .select(
      "id, ticker, entry_price, stop_loss, take_profit, qty, notional_at_entry, opened_at, side, be_activated_at, partial_taken, trail_active, trail_peak_pnl, trail_stop_price, management_meta, status",
    )
    .eq("engine_key", ENGINE_KEY)
    .eq("engine_version", ENGINE_VERSION)
    .eq("run_mode", RUN_MODE)
    .eq("status", "OPEN");

  if (error) {
    throw new Error(`[quick_profit] Failed to load positions: ${error.message}`);
  }

  const positions: QuickProfitPosition[] = (openPositions || []).map((pos: any) => ({
    id: pos.id,
    ticker: (pos.ticker || "").toUpperCase(),
    entry_price: Number(pos.entry_price),
    stop_loss: Number(pos.stop_loss),
    take_profit: pos.take_profit ? Number(pos.take_profit) : null,
    qty: Number(pos.qty || 0),
    notional_at_entry: Number(pos.notional_at_entry || 0),
    opened_at: pos.opened_at,
    side: (pos.side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG",
    be_activated_at: pos.be_activated_at,
    partial_taken: Boolean(pos.partial_taken),
    trail_active: Boolean(pos.trail_active),
    trail_peak_pnl: pos.trail_peak_pnl != null ? Number(pos.trail_peak_pnl) : null,
    trail_stop_price: pos.trail_stop_price != null ? Number(pos.trail_stop_price) : null,
    management_meta: pos.management_meta || {},
    status: pos.status,
  }));

  const tickers = positions.map((p) => p.ticker);
  const quotes = tickers.length > 0 ? await fetchBulkQuotes(tickers) : {};

  let allocated_notional = 0;
  let unrealized = 0;

  const tickerPriceMap = new Map<string, number>();

  for (const pos of positions) {
    allocated_notional += pos.notional_at_entry;
    const price = quotes?.[pos.ticker]?.price ?? pos.entry_price;
    tickerPriceMap.set(pos.ticker, price);
    unrealized += computeUnrealizedPnlDollars(pos, price);
  }

  const realized_before = await fetchRealizedPnl(supabase);
  const starting = Number(portfolio.starting_equity || 100000);
  const equity = starting + realized_before + unrealized;
  const cash = equity - allocated_notional - unrealized;

  const state: QuickProfitState = {
    startingEquity: starting,
    equity_dollars: equity,
    cash_dollars: cash,
    allocated_notional,
    open_positions_count: positions.length,
    unrealized_pnl_dollars: unrealized,
    realized_before,
    realized_delta: 0,
  };

  return { positions, state, tickerPriceMap };
}

async function fetchRealizedPnl(supabase: any): Promise<number> {
  const { data, error } = await supabase
    .from("engine_trades")
    .select("realized_pnl")
    .eq("engine_key", ENGINE_KEY)
    .eq("engine_version", ENGINE_VERSION)
    .eq("run_mode", RUN_MODE);

  if (error) {
    console.warn("[quick_profit] Failed to load realized PnL:", error);
    return 0;
  }

  return (data || []).reduce(
    (sum: number, row: any) => sum + Number(row.realized_pnl || 0),
    0,
  );
}

async function manageOpenPositions({
  supabase,
  positions,
  state,
  tickerPriceMap,
  nowUtc,
}: {
  supabase: any;
  positions: QuickProfitPosition[];
  state: QuickProfitState;
  tickerPriceMap: Map<string, number>;
  nowUtc: Date;
}) {
  for (const pos of positions) {
    const currentPrice = tickerPriceMap.get(pos.ticker) ?? pos.entry_price;
    const pnl = computeUnrealizedPnlDollars(pos, currentPrice);

    if (!pos.be_activated_at && pnl >= CONFIG.beTriggerUsd) {
      await activateBreakeven({ supabase, pos, currentPrice, nowUtc });
      await logQuickProfitAction(supabase, {
        ticker: pos.ticker,
        action: "BE_ACTIVATED",
        pnl,
        price: currentPrice,
      });
      pos.be_activated_at = nowUtc.toISOString();
    }

    if (!pos.partial_taken && pnl >= CONFIG.partialTriggerUsd) {
      const partial = await takePartialProfit({
        supabase,
        pos,
        currentPrice,
        pnl,
        state,
        nowUtc,
      });
      if (partial?.remainingQty) {
        await logQuickProfitAction(supabase, {
          ticker: pos.ticker,
          action: "PARTIAL_TAKEN",
          pnl,
          price: currentPrice,
          metadata: { remaining_qty: partial.remainingQty },
        });
        tickerPriceMap.set(pos.ticker, currentPrice);
      }
      continue; // partial function handles remainder updates
    }

    if (pos.trail_active) {
      await updateTrailingStop({
        supabase,
        pos,
        currentPrice,
        pnl,
        state,
        nowUtc,
      });
      tickerPriceMap.set(pos.ticker, currentPrice);
      continue;
    }

    const stopHit = shouldHitStopLoss(pos, currentPrice);
    if (stopHit) {
      await closeQuickProfitPosition({
        supabase,
        pos,
        exitPrice: pos.stop_loss,
        exitReason: "STOP_LOSS",
        state,
        nowUtc,
      });
      tickerPriceMap.set(pos.ticker, currentPrice);
      continue;
    }
  }
}

async function activateBreakeven({
  supabase,
  pos,
  currentPrice,
  nowUtc,
}: {
  supabase: any;
  pos: QuickProfitPosition;
  currentPrice: number;
  nowUtc: Date;
}) {
  const bufferPerShare = CONFIG.beBufferUsd / Math.max(pos.qty, 1);
  const newStop =
    pos.side === "LONG"
      ? pos.entry_price + bufferPerShare
      : pos.entry_price - bufferPerShare;

  guardShadowWrite("engine_positions");
  await supabase
    .from("engine_positions")
    .update({
      stop_loss: newStop,
      be_activated_at: nowUtc.toISOString(),
    })
    .eq("id", pos.id);

  pos.stop_loss = newStop;
  pos.be_activated_at = nowUtc.toISOString();
}

async function takePartialProfit({
  supabase,
  pos,
  currentPrice,
  pnl,
  state,
  nowUtc,
}: {
  supabase: any;
  pos: QuickProfitPosition;
  currentPrice: number;
  pnl: number;
  state: QuickProfitState;
  nowUtc: Date;
}) {
  const closeQty = Math.floor(pos.qty * CONFIG.partialFraction);
  const remainingQty = pos.qty - closeQty;
  if (closeQty <= 0 || remainingQty <= 0) {
    return null;
  }

  const realizedPnl = computeRealizedPnl(pos, currentPrice, closeQty);
  const closedNotional = (pos.notional_at_entry * closeQty) / pos.qty;

  guardShadowWrite("engine_trades");
  await supabase.from("engine_trades").insert({
    engine_key: ENGINE_KEY,
    engine_version: ENGINE_VERSION,
    run_mode: RUN_MODE,
    ticker: pos.ticker,
    side: pos.side,
    entry_price: pos.entry_price,
    exit_price: currentPrice,
    opened_at: pos.opened_at,
    closed_at: nowUtc.toISOString(),
    realized_pnl: realizedPnl,
    realized_r: null,
    meta: {
      exit_reason: "PARTIAL_PROFIT",
      qty: closeQty,
    },
  });

  state.realized_delta += realizedPnl;
  state.cash_dollars += closedNotional + realizedPnl;
  state.allocated_notional -= closedNotional;

  const perShareTrail =
    CONFIG.trailDistanceUsd / Math.max(remainingQty, 1);
  const trailStopPrice =
    pos.side === "LONG"
      ? currentPrice - perShareTrail
      : currentPrice + perShareTrail;

  guardShadowWrite("engine_positions");
  await supabase
    .from("engine_positions")
    .update({
      qty: remainingQty,
      notional_at_entry: pos.entry_price * remainingQty,
      partial_taken: true,
      trail_active: true,
      trail_peak_pnl: pnl - realizedPnl,
      trail_stop_price: trailStopPrice,
      stop_loss: Math.max(pos.stop_loss, trailStopPrice),
    })
    .eq("id", pos.id);

  pos.qty = remainingQty;
  pos.notional_at_entry = pos.entry_price * remainingQty;
  pos.partial_taken = true;
  pos.trail_active = true;
  pos.trail_peak_pnl = pnl - realizedPnl;
  pos.trail_stop_price = trailStopPrice;

  return { remainingQty };
}

async function updateTrailingStop({
  supabase,
  pos,
  currentPrice,
  pnl,
  state,
  nowUtc,
}: {
  supabase: any;
  pos: QuickProfitPosition;
  currentPrice: number;
  pnl: number;
  state: QuickProfitState;
  nowUtc: Date;
}) {
  const peak = pos.trail_peak_pnl ?? pnl;
  let newPeak = peak;
  let newStop = pos.trail_stop_price ?? pos.stop_loss;

  if (pnl > peak) {
    newPeak = pnl;
    const perShareTrail = CONFIG.trailDistanceUsd / Math.max(pos.qty, 1);
    newStop =
      pos.side === "LONG"
        ? currentPrice - perShareTrail
        : currentPrice + perShareTrail;
  }

  const stopHit =
    pos.side === "LONG"
      ? currentPrice <= (newStop ?? pos.stop_loss)
      : currentPrice >= (newStop ?? pos.stop_loss);

  if (stopHit) {
    await closeQuickProfitPosition({
      supabase,
      pos,
      exitPrice: newStop ?? currentPrice,
      exitReason: "TRAIL_STOP",
      state,
      nowUtc,
    });
    await logQuickProfitAction(supabase, {
      ticker: pos.ticker,
      action: "TRAIL_STOP_HIT",
      pnl,
      price: currentPrice,
    });
    return;
  }

  if (newPeak !== peak || newStop !== pos.trail_stop_price) {
    guardShadowWrite("engine_positions");
    await supabase
      .from("engine_positions")
      .update({
        trail_peak_pnl: newPeak,
        trail_stop_price: newStop,
      })
      .eq("id", pos.id);

    pos.trail_peak_pnl = newPeak;
    pos.trail_stop_price = newStop;
  }
}

async function closeQuickProfitPosition({
  supabase,
  pos,
  exitPrice,
  exitReason,
  state,
  nowUtc,
}: {
  supabase: any;
  pos: QuickProfitPosition;
  exitPrice: number;
  exitReason: string;
  state: QuickProfitState;
  nowUtc: Date;
}) {
  const realizedPnl = computeRealizedPnl(pos, exitPrice, pos.qty);

  guardShadowWrite("engine_trades");
  await supabase.from("engine_trades").insert({
    engine_key: ENGINE_KEY,
    engine_version: ENGINE_VERSION,
    run_mode: RUN_MODE,
    ticker: pos.ticker,
    side: pos.side,
    entry_price: pos.entry_price,
    exit_price: exitPrice,
    opened_at: pos.opened_at,
    closed_at: nowUtc.toISOString(),
    realized_pnl: realizedPnl,
    realized_r: null,
    meta: { exit_reason: exitReason, qty: pos.qty },
  });

  guardShadowWrite("engine_positions");
  await supabase
    .from("engine_positions")
    .update({
      status: "CLOSED",
      closed_at: nowUtc.toISOString(),
      exit_price: exitPrice,
      exit_reason: exitReason,
      realized_pnl: realizedPnl,
    })
    .eq("id", pos.id);

  state.realized_delta += realizedPnl;
  state.cash_dollars += pos.notional_at_entry + realizedPnl;
  state.allocated_notional -= pos.notional_at_entry;
  state.open_positions_count -= 1;
  pos.status = "CLOSED";
}

function computeUnrealizedPnlDollars(
  pos: Pick<QuickProfitPosition, "qty" | "entry_price" | "side">,
  currentPrice: number,
) {
  const priceDiff =
    pos.side === "LONG"
      ? currentPrice - pos.entry_price
      : pos.entry_price - currentPrice;
  return priceDiff * pos.qty;
}

function computeRealizedPnl(
  pos: Pick<QuickProfitPosition, "entry_price" | "side">,
  exitPrice: number,
  shares: number,
) {
  const priceDiff =
    pos.side === "LONG"
      ? exitPrice - pos.entry_price
      : pos.entry_price - exitPrice;
  return priceDiff * shares;
}

function shouldHitStopLoss(pos: QuickProfitPosition, currentPrice: number) {
  if (pos.side === "LONG") {
    return currentPrice <= pos.stop_loss;
  }
  return currentPrice >= pos.stop_loss;
}

async function processQuickProfitSignals({
  supabase,
  state,
  allowedSymbols,
  nowUtc,
  existingTickers,
}: {
  supabase: any;
  state: QuickProfitState;
  allowedSymbols: string[];
  nowUtc: Date;
  existingTickers: Set<string>;
}) {
  const lookbackMs = CONFIG.lookbackHours * 60 * 60 * 1000;
  const lookbackStartIso = new Date(nowUtc.getTime() - lookbackMs).toISOString();

  const { data: signals, error } = await fetchSignalsWithAllowlist(
    supabase,
    "SWING",
    lookbackStartIso,
    {
      allowlistSymbols: allowedSymbols,
      allowlistBypassConfidence: allowedSymbols.length > 0,
    },
  );

  if (error) {
    console.warn("[quick_profit] Failed to load signals:", error);
    return;
  }

  for (const signal of signals || []) {
    const ticker = (signal.symbol || "").toUpperCase();
    if (allowedSymbols.length > 0 && !allowedSymbols.includes(ticker)) {
      console.warn(`[quick_profit] Skipping ${ticker} - outside live universe`);
      continue;
    }
    if (existingTickers.has(ticker)) {
      continue;
    }
    if (state.open_positions_count >= CONFIG.maxConcurrentPositions) {
      break;
    }

    const positionSize = calculateQuickProfitPositionSize(state, signal);
    if (!positionSize) continue;

    await openQuickProfitPosition({
      supabase,
      signal,
      positionSize,
      nowUtc,
    });

    existingTickers.add(ticker);
    state.cash_dollars -= positionSize.notional;
    state.allocated_notional += positionSize.notional;
    state.open_positions_count += 1;

    await logQuickProfitAction(supabase, {
      ticker,
      action: "OPEN",
      pnl: 0,
      price: signal.entry_price,
      metadata: { size_shares: positionSize.size_shares },
      signal_id: signal.id,
    });
  }
}

function calculateQuickProfitPositionSize(
  state: QuickProfitState,
  signal: any,
) {
  const riskPerTrade = state.equity_dollars * CONFIG.riskPerTradePct;
  const riskPerShare = Math.abs(signal.entry_price - signal.stop_loss);
  if (riskPerShare <= 0) return null;

  let sizeShares = Math.floor(riskPerTrade / riskPerShare);
  if (sizeShares <= 0) return null;

  let notional = sizeShares * signal.entry_price;
  const maxNotional = state.equity_dollars * CONFIG.maxNotionalPerPositionPct;
  if (notional > maxNotional) {
    sizeShares = Math.floor(maxNotional / signal.entry_price);
    notional = sizeShares * signal.entry_price;
  }

  const maxAllocation = state.equity_dollars * CONFIG.maxPortfolioAllocationPct;
  const remainingCapacity = maxAllocation - state.allocated_notional;
  if (remainingCapacity <= 0) return null;
  if (notional > remainingCapacity) {
    sizeShares = Math.floor(remainingCapacity / signal.entry_price);
    notional = sizeShares * signal.entry_price;
  }

  if (notional < CONFIG.minPositionNotional || sizeShares < 1) {
    return null;
  }

  const riskDollars = sizeShares * riskPerShare;
  return { size_shares: sizeShares, notional, risk_dollars: riskDollars };
}

async function openQuickProfitPosition({
  supabase,
  signal,
  positionSize,
  nowUtc,
}: {
  supabase: any;
  signal: any;
  positionSize: { size_shares: number; notional: number; risk_dollars: number };
  nowUtc: Date;
}) {
  const ticker = (signal.symbol || "").toUpperCase();
  const side = (signal.signal_type || "buy").toLowerCase() === "sell"
    ? "SHORT"
    : "LONG";

  guardShadowWrite("engine_positions");
  await supabase.from("engine_positions").insert({
    engine_key: ENGINE_KEY,
    engine_version: ENGINE_VERSION,
    run_mode: RUN_MODE,
    ticker,
    side,
    qty: positionSize.size_shares,
    entry_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    take_profit: signal.take_profit_1,
    opened_at: nowUtc.toISOString(),
    status: "OPEN",
    notional_at_entry: positionSize.notional,
    risk_dollars: positionSize.risk_dollars,
    be_activated_at: null,
    partial_taken: false,
    trail_active: false,
    trail_peak_pnl: null,
    trail_stop_price: null,
    management_meta: {
      source_signal_id: signal.id,
    },
  });
}

async function persistPortfolioSnapshot({
  supabase,
  state,
  portfolio,
  nowUtc,
}: {
  supabase: any;
  state: QuickProfitState;
  portfolio: any;
  nowUtc: Date;
}) {
  await refreshStateFromDB(supabase, state);
  const updatedEquity = computeEquityFromState(state);
  state.equity_dollars = updatedEquity;
  state.cash_dollars = updatedEquity - state.allocated_notional - state.unrealized_pnl_dollars;

  guardShadowWrite("engine_portfolios");
  await supabase
    .from("engine_portfolios")
    .update({
      equity: state.equity_dollars,
      allocated_notional: state.allocated_notional,
      updated_at: nowUtc.toISOString(),
    })
    .eq("id", portfolio.id);
}

async function logQuickProfitAction(
  supabase: any,
  params: {
    ticker: string;
    action: string;
    pnl: number;
    price: number;
    metadata?: Record<string, unknown>;
    signal_id?: string;
  },
) {
  guardShadowWrite("live_signal_decision_log");
  await supabase.from("live_signal_decision_log").insert({
    signal_id: params.signal_id ?? null,
    strategy: "SWING",
    engine_type: "SWING",
    ticker: params.ticker,
    decision: params.action,
    reason_code: params.action,
    reason_context: {
      pnl_usd: params.pnl,
      price: params.price,
      ...params.metadata,
    },
    engine_key: ENGINE_KEY,
    engine_version: ENGINE_VERSION,
    run_mode: RUN_MODE,
    publishable_signal: false,
    portfolio_equity: null,
  });
}

export {
  guardShadowWrite,
  CONFIG,
  buildAllowedSymbols,
  calculateQuickProfitPositionSize,
  computeUnrealizedPnlDollars,
  computeEquityFromState,
  shouldHitStopLoss,
};

async function refreshStateFromDB(supabase: any, state: QuickProfitState) {
  const { data, error } = await supabase
    .from("engine_positions")
    .select("ticker, entry_price, qty, notional_at_entry, side")
    .eq("engine_key", ENGINE_KEY)
    .eq("engine_version", ENGINE_VERSION)
    .eq("run_mode", RUN_MODE)
    .eq("status", "OPEN");

  if (error) {
    console.warn("[quick_profit] Failed to refresh portfolio state:", error);
    return;
  }

  const openPositions = data || [];
  const tickers = openPositions.map((row: any) => (row.ticker || "").toUpperCase());
  const quotes = tickers.length > 0 ? await fetchBulkQuotes(tickers) : {};

  let allocated = 0;
  let unrealized = 0;

  for (const row of openPositions) {
    const ticker = (row.ticker || "").toUpperCase();
    const qty = Number(row.qty || 0);
    const entry = Number(row.entry_price || 0);
    const side = (row.side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    const price = quotes?.[ticker]?.price ?? entry;
    allocated += Number(row.notional_at_entry || 0);
    unrealized += computeUnrealizedPnlDollars({ qty, entry_price: entry, side } as QuickProfitPosition, price);
  }

  state.allocated_notional = allocated;
  state.unrealized_pnl_dollars = unrealized;
  state.open_positions_count = openPositions.length;
}

function computeEquityFromState(state: QuickProfitState) {
  return (
    state.startingEquity +
    state.realized_before +
    state.realized_delta +
    state.unrealized_pnl_dollars
  );
}
