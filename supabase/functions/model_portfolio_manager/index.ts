// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchBulkQuotes, fetchIntradayOHLC, fetchPositionBars } from "../_shared/yahoo_v8_client.ts";
import { isDaytraderDisabled, logEngineConfigOnce, getCryptoShadowConfig } from "../_shared/config.ts";
import {
  AllocationFlags,
  loadAllocationFlags,
} from "../_shared/engine_allocation.ts";
import {
  getLiveSwingUniverse,
  resolveEngineRouting,
  type AllocationContext,
} from "../_shared/universe.ts";
import { calculateATR } from "../_shared/price_levels_calculator.ts";
import {
  evaluateOvernightHygiene,
  isInPreCloseWindow,
  OvernightHygieneContext,
} from "./overnight_hygiene.ts";
import { getTradeGateStatus, type TradeGateStatus } from "../_shared/trade_gate.ts";
import { runCryptoShadowTick } from "../_shared/engines/crypto_v1_shadow/index.ts";
import { fetchSignalsWithAllowlist } from "../_shared/signals.ts";
import { runQuickProfitTick } from "./quick_profit.ts";
import { buildPortfolioBucketGuard, type PortfolioBucketGuard } from "../_shared/portfolio_core.ts";

const DAYTRADE_CONFIG = {
  strategy: "DAYTRADE",
  initial_equity: 100_000,
  risk_per_trade_pct: 0.01, // 1%
  max_notional_per_position_pct: 0.25, // 25%
  max_concurrent_positions: 3,
  max_portfolio_allocation_pct: 0.80, // 80%
  min_position_notional: 1000,
  eod_flatten_hour_utc: 20,
  eod_flatten_minute_utc: 55,
  engine_version: "V7.4",
  trailing_stop: {
    enabled: true,
    activation_threshold_R: 1.0, // Start trailing after 1R profit
    trail_distance_R: 0.5, // Trail 0.5R below peak
  },
};

const SWING_CONFIG = {
  strategy: "SWING",
  initial_equity: 100_000,
  risk_per_trade_pct: 0.0075, // 0.75%
  max_notional_per_position_pct: 0.25, // 25%
  max_concurrent_positions: 10,
  max_portfolio_allocation_pct: 0.80, // 80%
  min_position_notional: 1000,
  engine_version: "SWING_V1_EXPANSION", // Tag current live engine explicitly
  trailing_stop: {
    enabled: true,
    activation_threshold_R: 1.5, // Start trailing after 1.5R profit
    trail_distance_R: 0.75, // Trail 0.75R below peak
  },
};

type EngineRunMode = 'PRIMARY' | 'SHADOW';

interface EngineContext {
  engineKey: 'SWING';
  engineVersion: string;
  runMode: EngineRunMode;
  nowUtc: Date;
}


function assertRunMode(
  ctx: EngineContext,
  expected: EngineRunMode,
  operation: string,
) {
  if (ctx.runMode !== expected) {
    const msg = `[engine_guard] RunMode violation: expected=${expected}, got=${ctx.runMode}, engineKey=${ctx.engineKey}, engineVersion=${ctx.engineVersion}, op=${operation}`;
    console.error(msg);
    throw new Error(msg);
  }
}

interface PortfolioState {
  strategy: string;
  equity_dollars: number;
  cash_dollars: number;
  open_positions_count: number;
  allocated_notional: number;
  unrealized_pnl_dollars: number;
}

interface Position {
  id: number;
  strategy: string;
  ticker: string;
  signal_id: string;
  engine_key?: string;
  engine_version: string;
  entry_timestamp: string;
  entry_price: number;
  size_shares: number;
  notional_at_entry: number;
  stop_loss: number;
  take_profit: number;
  risk_dollars: number;
  risk_r: number;
  current_price: number | null;
  unrealized_pnl_dollars: number | null;
  unrealized_pnl_r: number | null;
  // optional fields from DB
  initial_risk_price?: number | null;
  has_recycled_capital?: boolean | null;
  // TP2 runner fields
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_hit?: boolean | null;
  runner_active?: boolean | null;
}

interface Signal {
  id: string;
  symbol: string;  // ai_signals uses 'symbol'
  trading_style: string;  // 'daytrade' or 'swing'
  engine_type: string;     // 'DAYTRADER' | 'SWING' | 'INVESTOR'
  signal_type: 'buy' | 'sell' | 'neutral';
  ai_decision?: 'buy' | 'sell' | 'neutral';
  confidence_score: number;
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;  // ai_signals uses 'take_profit_1'
  engine_version: string;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const cryptoOnly = url.searchParams.get("cryptoOnly") === "1";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    logEngineConfigOnce('model_portfolio_manager');
    console.log("🤖 Model Portfolio Manager - Starting");

    const nowUtc = new Date();
    const primaryCtx: EngineContext = {
      engineKey: 'SWING',
      engineVersion: 'SWING_V1_EXPANSION',
      runMode: 'PRIMARY',
      nowUtc,
    };
    // PRIMARY pass: live engine using live_* tables (skip when cryptoOnly)
    if (!cryptoOnly) {
      if (!isDaytraderDisabled()) {
        await processStrategy(primaryCtx, supabase, DAYTRADE_CONFIG);
      } else {
        console.log('[model_portfolio_manager] Daytrader disabled via MARILD_DISABLE_DAYTRADER, skipping DAYTRADE strategy.');
      }
      await processStrategy(primaryCtx, supabase, SWING_CONFIG);
      try {
        await runQuickProfitTick({ supabase, nowUtc });
      } catch (qpErr) {
        console.error("[quick_profit] Error during run:", qpErr);
      }
    } else {
      console.log('[model_portfolio_manager] cryptoOnly=1 -> skipping DAYTRADE and SWING passes');
    }
    await processStrategy(primaryCtx, supabase, SWING_CONFIG);

    // SHADOW pass: run enabled shadow engines in isolation (engine_* tables only)
    if (!cryptoOnly) {
      try {
        const { data: shadowEngines, error: shadowErr } = await supabase
          .from('engine_versions')
          .select('engine_version, run_mode, is_enabled, stopped_at')
          .eq('engine_key', 'SWING')
          .eq('run_mode', 'SHADOW')
          .eq('is_enabled', true)
          .is('stopped_at', null);

        if (shadowErr) {
          console.warn('[model_portfolio_manager] Failed to load shadow engines:', shadowErr.message ?? shadowErr);
        } else if (shadowEngines && shadowEngines.length > 0) {
          for (const row of shadowEngines) {
            const shadowCtx: EngineContext = {
              engineKey: 'SWING',
              engineVersion: row.engine_version,
              runMode: 'SHADOW',
              nowUtc: new Date(),
            };

            try {
              console.log(`[shadow] Running shadow engine ${shadowCtx.engineVersion} (runMode=${shadowCtx.runMode})`);
              await runShadowEngine(shadowCtx, supabase);
            } catch (shadowRunErr) {
              console.error('[shadow] Error running shadow engine', shadowCtx.engineVersion, shadowRunErr);
            }
          }
        } else {
          console.log('[shadow] No enabled shadow engines for SWING');
        }
      } catch (shadowWrapperErr) {
        console.error('[shadow] Unexpected error while orchestrating shadow engines:', shadowWrapperErr);
      }
    } else {
      console.log('[shadow] cryptoOnly=1 -> skipping SWING shadow engines');
    }

    // CRYPTO shadow engine (single entry point, same worker)
    try {
      const cryptoCfg = getCryptoShadowConfig();
      if (cryptoCfg.enabled) {
        console.log('[shadow] Running CRYPTO_V1_SHADOW tick');
        await runCryptoShadowTick({ supabase, nowUtc });
      } else {
        console.log('[shadow] CRYPTO_V1_SHADOW disabled');
      }
    } catch (cryptoErr) {
      console.error('[shadow] Error running CRYPTO_V1_SHADOW', cryptoErr);
    }

    console.log("✅ Model Portfolio Manager - Complete");

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ Model Portfolio Manager error:", error);
    return new Response(JSON.stringify({ error: (error as any)?.message ?? String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

type CapitalRecyclingMode = 'OFF' | 'ON' | 'STRICT';

/**
 * Returns engine-version-specific config overrides.
 * Used to differentiate V2 from V1 parameters.
 */
function getEngineConfig(engineVersion: string) {
  // V2 (SWING_V2_ROBUST): More aggressive trailing stop, tighter time-exit
  if (engineVersion === 'SWING_V2_ROBUST') {
    return {
      trailing_stop: {
        enabled: true,
        activation_threshold_R: 1.0,  // Activate after 1R profit (vs 1.5R in V1)
        trail_distance_R: 0.5,         // Trail 0.5R below peak (vs 0.75R in V1)
      },
      time_exit_threshold_R: 0.4,      // Exit sideways trades at 0.4R+ (vs 0.6R in V1)
    };
  }

  // V1 engines (SWING_V1_EXPANSION, SWING_V1_12_15DEC) or default: original parameters
  return {
    trailing_stop: {
      enabled: true,
      activation_threshold_R: 1.5,
      trail_distance_R: 0.75,
    },
    time_exit_threshold_R: 0.6,
  };
}

async function runShadowEngine(ctx: EngineContext, supabase: any) {
  // Shadow engine: maintains virtual portfolio state in engine_* tables,
  // operates independently from PRIMARY live_* tables.

  if (ctx.engineKey !== 'SWING') return;

  console.log(`[shadow] Starting shadow engine run for ${ctx.engineVersion}`);

  // 1. Ensure a portfolio row exists
  const { data: existingPortfolios, error: portfolioErr } = await supabase
    .from('engine_portfolios')
    .select('*')
    .eq('engine_key', ctx.engineKey)
    .eq('engine_version', ctx.engineVersion)
    .eq('run_mode', ctx.runMode)
    .limit(1);

  if (portfolioErr) {
    console.error('[shadow] Failed to load engine_portfolios:', portfolioErr);
    return;
  }

  let portfolio = existingPortfolios && existingPortfolios[0];
  if (!portfolio) {
    assertRunMode(ctx, 'SHADOW', 'insert engine_portfolios (init)');

    // SWING_SHADOW_CTX_V1 should start from current live SWING equity,
    // so its net return is directly comparable to the live engine.
    let startingEquity = 100000;
    if (ctx.engineKey === 'SWING' && ctx.engineVersion === 'SWING_SHADOW_CTX_V1') {
      const liveEquity = await loadCurrentLiveSwingEquity(supabase);
      if (liveEquity !== null && liveEquity > 0) {
        startingEquity = liveEquity;
        console.log(
          `[shadow] Using live SWING equity $${liveEquity.toFixed(
            2,
          )} as starting_equity for SWING_SHADOW_CTX_V1`,
        );
      } else {
        console.warn(
          '[shadow] Falling back to default starting_equity=100000 for SWING_SHADOW_CTX_V1 (live equity unavailable)',
        );
      }
    }

    const { data: inserted, error: insertPortfolioErr } = await supabase
      .from('engine_portfolios')
      .insert({
        engine_key: ctx.engineKey,
        engine_version: ctx.engineVersion,
        run_mode: ctx.runMode,
        starting_equity: startingEquity,
        equity: startingEquity,
        allocated_notional: 0,
      })
      .select('*')
      .limit(1);

    if (insertPortfolioErr) {
      console.error('[shadow] Failed to initialize engine_portfolios:', insertPortfolioErr);
      return;
    }

    portfolio = inserted && inserted[0];
  }

  // 2. Load open virtual positions
  const { data: openPositions, error: openErr } = await supabase
    .from('engine_positions')
    .select('*')
    .eq('engine_key', ctx.engineKey)
    .eq('engine_version', ctx.engineVersion)
    .eq('run_mode', ctx.runMode)
    .eq('status', 'OPEN');

  if (openErr) {
    console.error('[shadow] Failed to load engine_positions:', openErr);
    return;
  }

  const positions = openPositions || [];

  // 3. Compute equity/cash/allocated_notional from virtual positions
  const allocatedNotional = positions.reduce(
    (sum: number, p: any) => sum + Number(p.notional_at_entry || 0),
    0,
  );

  const { data: trades, error: tradesErr } = await supabase
    .from('engine_trades')
    .select('realized_pnl')
    .eq('engine_key', ctx.engineKey)
    .eq('engine_version', ctx.engineVersion)
    .eq('run_mode', ctx.runMode);

  if (tradesErr) {
    console.error('[shadow] Failed to load engine_trades:', tradesErr);
    return;
  }

  const realizedPnl = (trades || []).reduce(
    (sum: number, t: any) => sum + Number(t.realized_pnl || 0),
    0,
  );

  const unrealizedPnl = 0; // Simplified for now
  const equity = Number(portfolio.starting_equity || 100000) + realizedPnl + unrealizedPnl;
  const cash = equity - allocatedNotional - unrealizedPnl;

  // Optionally load latest market context decision for context shadow engine.
  let marketContextDecision: any | null = null;
  if (ctx.engineKey === 'SWING' && ctx.engineVersion === 'SWING_SHADOW_CTX_V1') {
    marketContextDecision = await loadLatestMarketContextDecision(supabase);
    if (marketContextDecision) {
      console.log(
        `[shadow] Loaded market context decision as_of=${marketContextDecision.as_of} ` +
          `regime=${marketContextDecision.regime} gate=${marketContextDecision.trade_gate} ` +
          `risk_scale=${marketContextDecision.risk_scale}`,
      );
    } else {
      console.log('[shadow] No market context decision found for CTX_V1_MINIMAL; falling back to base config.');
    }
  }

  // 4. Build config with version-specific overrides
  const baseConfig = { ...SWING_CONFIG };
  const engineOverrides = getEngineConfig(ctx.engineVersion);
  const config: any = {
    ...baseConfig,
    trailing_stop: engineOverrides.trailing_stop,
    time_exit_threshold_R: engineOverrides.time_exit_threshold_R,
  };

  if (marketContextDecision) {
    const rawScale = marketContextDecision.risk_scale;
    const riskScale =
      typeof rawScale === 'number' && Number.isFinite(rawScale) && rawScale >= 0 ? rawScale : 1;
    if (riskScale !== 1) {
      config.risk_per_trade_pct = Number((config.risk_per_trade_pct * riskScale).toFixed(6));
    }

    const maxOverrideRaw = marketContextDecision.max_positions_override;
    if (maxOverrideRaw != null) {
      const maxOverride = Number(maxOverrideRaw);
      if (Number.isFinite(maxOverride) && maxOverride > 0) {
        config.max_concurrent_positions = Math.min(config.max_concurrent_positions, maxOverride);
      }
    }
  }

  let state: PortfolioState = {
    strategy: 'SWING',
    equity_dollars: equity,
    cash_dollars: cash,
    open_positions_count: positions.length,
    allocated_notional: allocatedNotional,
    unrealized_pnl_dollars: unrealizedPnl,
  };

  // 5. Update existing positions and check exits
  if (positions.length > 0) {
    state = await updateShadowPositionsAndCheckExits(
      ctx,
      supabase,
      config,
      positions,
      state,
      ctx.nowUtc
    );
  }

  // 6. Scan for new SWING signals (unless trade gate is closed by market context)
  const lookbackHours = 6;
  const lookbackMs = lookbackHours * 60 * 60 * 1000;
  const lookbackStartIso = new Date(Date.now() - lookbackMs).toISOString();
  const allocationFlags = await loadAllocationFlags(supabase);
  const shadowAllowlist =
    allocationFlags.enabled && allocationFlags.allowlist.size > 0
      ? Array.from(allocationFlags.allowlist).map((symbol) => symbol.toUpperCase())
      : [];

  const isGateClosedByContext =
    marketContextDecision &&
    typeof marketContextDecision.trade_gate === 'string' &&
    marketContextDecision.trade_gate.toUpperCase() === 'CLOSE';

  if (isGateClosedByContext) {
    console.log(
      `[shadow] ${ctx.engineVersion}: Trade gate CLOSED by market context (as_of=${marketContextDecision.as_of}). Skipping new entries.`,
    );
  } else {
    const { data: newSignals, error: signalErr } = await fetchSignalsWithAllowlist(
      supabase,
      'SWING',
      lookbackStartIso,
      {
        allowlistSymbols: shadowAllowlist,
        allowlistBypassConfidence: shadowAllowlist.length > 0,
      },
    );

    if (signalErr) {
      console.error('[shadow] Failed to load ai_signals for shadow engine:', signalErr);
      return;
    }

    console.log(`[shadow] ${ctx.engineVersion}: New signals found: ${newSignals?.length || 0}`);

    // 7. Process new signals (with promotion gating for V2)
    if (newSignals && newSignals.length > 0) {
      await processShadowSignals(ctx, supabase, config, newSignals as any, state);
    }
  }

  // 8. Update virtual portfolio snapshot
  assertRunMode(ctx, 'SHADOW', 'update engine_portfolios snapshot');
  await supabase
    .from('engine_portfolios')
    .update({
      equity: state.equity_dollars,
      allocated_notional: state.allocated_notional,
      updated_at: new Date().toISOString(),
    })
    .eq('id', portfolio.id);

  console.log(`[shadow] Completed shadow engine run for ${ctx.engineVersion}`);
}

async function loadCurrentLiveSwingEquity(supabase: any): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('live_portfolio_state')
      .select('equity_dollars, timestamp')
      .eq('strategy', 'SWING')
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('[shadow] Failed to load live SWING equity for context shadow start:', error.message ?? error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const row = data[0] as any;
    const val = Number(row.equity_dollars ?? 0);
    return Number.isFinite(val) ? val : null;
  } catch (err) {
    console.warn('[shadow] Unexpected error loading live SWING equity for context shadow start:', err);
    return null;
  }
}

async function loadLatestMarketContextDecision(supabase: any): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('market_context_policy_decisions')
      .select('policy_version, as_of, trade_gate, risk_scale, max_positions_override, regime, notes')
      .eq('policy_version', 'CTX_V1_MINIMAL')
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[shadow] Failed to load market context decision:', error.message ?? error);
      return null;
    }

    if (!data) return null;
    return data as any;
  } catch (err) {
    console.warn('[shadow] Unexpected error loading market context decision:', err);
    return null;
  }
}

async function loadStrategyFlags(supabase: any, strategy: string) {
  try {
    const { data, error } = await supabase
      .from('strategy_flags')
      .select('allow_capital_recycling, allow_slot_release, is_trend_follower, enable_tp2, tp2_r_multiple, tp1_close_pct, move_sl_to_breakeven, capital_recycling_mode')
      .eq('strategy', strategy)
      .maybeSingle();

    // Default flags if row missing or error
    if (error || !data) {
      return {
        allowCapitalRecycling: false,
        allowSlotRelease: false,
        isTrendFollower: false,
        enableTp2: false,
        tp2RMultiple: 3.0,
        tp1ClosePct: 0.5,
        moveSlToBreakeven: true,
        capitalRecyclingMode: 'OFF' as CapitalRecyclingMode,
      };
    }

    // Map legacy boolean to mode if enum not populated yet
    let mode: CapitalRecyclingMode;
    const rawMode = (data as any).capital_recycling_mode as string | null;
    if (rawMode === 'ON' || rawMode === 'STRICT' || rawMode === 'OFF') {
      mode = rawMode;
    } else {
      mode = data.allow_capital_recycling ? 'ON' : 'OFF';
    }

    return {
      allowCapitalRecycling: Boolean(data.allow_capital_recycling),
      allowSlotRelease: Boolean(data.allow_slot_release),
      isTrendFollower: Boolean(data.is_trend_follower),
      enableTp2: Boolean(data.enable_tp2),
      tp2RMultiple: Number(data.tp2_r_multiple) || 3.0,
      tp1ClosePct: Number(data.tp1_close_pct) || 0.5,
      moveSlToBreakeven: Boolean(data.move_sl_to_breakeven ?? true),
      capitalRecyclingMode: mode,
    };
  } catch (_e) {
    return {
      allowCapitalRecycling: false,
      allowSlotRelease: false,
      isTrendFollower: false,
      enableTp2: false,
      tp2RMultiple: 3.0,
      tp1ClosePct: 0.5,
      moveSlToBreakeven: true,
      capitalRecyclingMode: 'OFF' as CapitalRecyclingMode,
    };
  }
}


function matchesOwnedEngineVersion(
  signalVersion: string | null | undefined,
  ownedVersion: string,
): boolean {
  if (!ownedVersion) return true;
  if (ownedVersion === 'BASELINE') {
    return (
      !signalVersion ||
      signalVersion === 'BASELINE' ||
      signalVersion === 'SWING_V1_EXPANSION' ||
      signalVersion === 'SWING'
    );
  }
  return signalVersion === ownedVersion;
}
function computeContinuationScoreFromBars(
  recentBars: { high: number; low: number; close: number }[],
): number {
  if (!recentBars || recentBars.length === 0) return 0.5;
  const N = Math.min(8, recentBars.length);
  const bars = recentBars.slice(-N);

  const ranges = bars.map((b) => b.high - b.low);
  const atr = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  const sorted = [...ranges].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const compression = atr < p25 ? 1 : 0;

  const firstClose = bars[0].close;
  const lastClose = bars[bars.length - 1].close;
  const roc = (lastClose - firstClose) / Math.max(Math.abs(firstClose), 1e-6);

  let score = 0.5;
  if (roc > 0) score += 0.2;
  if (roc < 0) score -= 0.2;
  if (compression) score -= 0.2;

  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return score;
}

function computeDistanceToTp1RemainingPct(
  pos: Position,
  currentPrice: number,
  isLong: boolean
): number | null {
  const tp = pos.take_profit;
  const entry = pos.entry_price;
  
  if (isLong) {
    const fullRange = tp - entry;
    const remaining = tp - currentPrice;
    if (fullRange <= 0) return null;
    return (remaining / fullRange) * 100;
  } else {
    const fullRange = entry - tp;
    const remaining = currentPrice - tp;
    if (fullRange <= 0) return null;
    return (remaining / fullRange) * 100;
  }
}

/**
 * Validate signal SL/TP distances using ATR-based guardrails.
 * 
 * Regime-invariant validation that works for SPY, high-vol stocks, and leveraged ETFs
 * without per-symbol tuning.
 * 
 * Primary guardrails:
 * - SL distance <= 3.0 × ATR
 * - TP distance <= 6.0 × ATR
 * 
 * Absolute backstop (safety net for completely broken signals):
 * - SL distance <= 12% of entry
 * - TP distance <= 25% of entry
 * 
 * @returns null if valid, or a rejection object with decision and context
 */
async function validateSignalDistanceWithATR(
  ticker: string,
  signal: Signal,
  riskRewardRatio: number
): Promise<{ decision: string; context: Record<string, unknown> } | null> {
  const slDistance = Math.abs(signal.stop_loss - signal.entry_price);
  const tpDistance = Math.abs(signal.take_profit_1 - signal.entry_price);
  
  // Absolute backstop: hard fail for completely broken signals
  const slDistancePct = slDistance / signal.entry_price;
  const tpDistancePct = tpDistance / signal.entry_price;
  
  if (slDistancePct > 0.12) {
    return {
      decision: 'SKIP_DISTANCE_UNREALISTIC',
      context: {
        reason: 'SL exceeds absolute backstop',
        sl_distance_pct: (slDistancePct * 100).toFixed(2),
        max_allowed_pct: 12,
        stop_loss: signal.stop_loss,
        entry_price: signal.entry_price,
      },
    };
  }
  
  if (tpDistancePct > 0.25) {
    return {
      decision: 'SKIP_DISTANCE_UNREALISTIC',
      context: {
        reason: 'TP exceeds absolute backstop',
        tp_distance_pct: (tpDistancePct * 100).toFixed(2),
        max_allowed_pct: 25,
        take_profit: signal.take_profit_1,
        entry_price: signal.entry_price,
      },
    };
  }
  
  // Fetch OHLC data for ATR calculation
  let ohlcBars;
  try {
    ohlcBars = await fetchIntradayOHLC(ticker, '1h');
  } catch (err) {
    console.warn(`[ATR validation] Failed to fetch OHLC for ${ticker}:`, err?.message ?? err);
    // If we can't fetch OHLC, fall back to absolute backstop only (already passed above)
    return null;
  }
  
  if (!ohlcBars || ohlcBars.length < 15) {
    console.warn(`[ATR validation] Insufficient OHLC data for ${ticker} (${ohlcBars?.length || 0} bars), skipping ATR validation`);
    // Fall back to absolute backstop only
    return null;
  }
  
  // Calculate ATR
  let atr: number;
  try {
    atr = calculateATR(ohlcBars, 14);
  } catch (err) {
    console.warn(`[ATR validation] ATR calculation failed for ${ticker}:`, err?.message ?? err);
    return null;
  }
  
  // Validate against ATR-based thresholds
  const slATR = slDistance / atr;
  const tpATR = tpDistance / atr;
  
  const MAX_SL_ATR = 3.0;
  const MAX_TP_ATR = 6.0;
  
  if (slATR > MAX_SL_ATR) {
    return {
      decision: 'SKIP_DISTANCE_UNREALISTIC',
      context: {
        reason: 'SL exceeds ATR threshold',
        sl_distance: slDistance.toFixed(4),
        atr: atr.toFixed(4),
        sl_atr_multiple: slATR.toFixed(2),
        max_allowed_atr: MAX_SL_ATR,
        stop_loss: signal.stop_loss,
        entry_price: signal.entry_price,
      },
    };
  }
  
  if (tpATR > MAX_TP_ATR) {
    return {
      decision: 'SKIP_DISTANCE_UNREALISTIC',
      context: {
        reason: 'TP exceeds ATR threshold',
        tp_distance: tpDistance.toFixed(4),
        atr: atr.toFixed(4),
        tp_atr_multiple: tpATR.toFixed(2),
        max_allowed_atr: MAX_TP_ATR,
        take_profit: signal.take_profit_1,
        entry_price: signal.entry_price,
      },
    };
  }
  
  // Signal passed all validations
  return null;
}

async function processStrategy(ctx: EngineContext, supabase: any, config: any) {
  if (config.strategy === 'DAYTRADE' && isDaytraderDisabled()) {
    console.log('\n📊 Processing DAYTRADE skipped (Daytrader disabled)');
    return;
  }

  console.log(`\n📊 Processing ${config.strategy}`);

  // Load live flags from strategy_flags (DB is source of truth)
  const flags = await loadStrategyFlags(supabase, config.strategy);
  config.allowCapitalRecycling = flags.allowCapitalRecycling;
  config.allowSlotRelease = flags.allowSlotRelease;
  config.isTrendFollower = flags.isTrendFollower;
  config.enableTp2 = flags.enableTp2;
  config.tp2RMultiple = flags.tp2RMultiple;
  config.tp1ClosePct = flags.tp1ClosePct;
  config.moveSlToBreakeven = flags.moveSlToBreakeven;
  config.capitalRecyclingMode = flags.capitalRecyclingMode; // 'OFF' | 'ON' | 'STRICT'

  // 1. Load open positions from DB (source of truth)
  const { data: openPositions, error: posError } = await supabase
    .from("live_positions")
    .select("*")
    .eq("strategy", config.strategy);

  if (posError) {
    console.error(
      `Error loading positions for ${config.strategy}:`,
      posError
    );
    return;
  }

  const positions = openPositions || [];
  const openCount = positions.length;
  const totalNotional = positions.reduce(
    (sum: number, p: any) => sum + Number(p.notional_at_entry || 0),
    0
  );
  const totalUnrealized = positions.reduce(
    (sum: number, p: any) => sum + Number(p.unrealized_pnl_dollars || 0),
    0
  );

  // 2. Load realized P&L (source of truth) and latest portfolio state snapshot (for continuity)
  const { data: closedTrades, error: closedTradesError } = await supabase
    .from('live_trades')
    .select('realized_pnl_dollars')
    .eq('strategy', config.strategy)
    .not('exit_timestamp', 'is', null);

  if (closedTradesError) {
    console.error(`Error loading closed trades for ${config.strategy}:`, closedTradesError);
    return;
  }

  const realizedSinceInception = (closedTrades || []).reduce(
    (sum: number, t: any) => sum + Number(t.realized_pnl_dollars || 0),
    0,
  );

  const computedEquity = config.initial_equity + realizedSinceInception + totalUnrealized;
  const computedCash = computedEquity - totalNotional - totalUnrealized;

  const { data: latestState, error: stateError } = await supabase
    .from("live_portfolio_state")
    .select("*")
    .eq("strategy", config.strategy)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  let state: PortfolioState;

  if (stateError) {
    console.warn(`  ⚠️ Error loading state for ${config.strategy}, using computed state:`, stateError);
    state = {
      strategy: config.strategy,
      equity_dollars: computedEquity,
      cash_dollars: computedCash,
      open_positions_count: openCount,
      allocated_notional: totalNotional,
      unrealized_pnl_dollars: totalUnrealized,
    };
  } else if (!latestState) {
    // No existing state row - initialize from computed truth
    console.warn(`  ⚠️ No existing state for ${config.strategy}, initializing from computed state`);
    state = {
      strategy: config.strategy,
      equity_dollars: computedEquity,
      cash_dollars: computedCash,
      open_positions_count: openCount,
      allocated_notional: totalNotional,
      unrealized_pnl_dollars: totalUnrealized,
    };
  } else {
    // Always prefer computed state (trades + open positions) so realized P&L is never lost.
    const snapshot = latestState as PortfolioState;

    const equityDiff = Math.abs(Number(snapshot.equity_dollars || 0) - computedEquity);
    if (equityDiff > 1) {
      console.warn(
        `  ⚠️ Snapshot equity differs from computed equity for ${config.strategy}. ` +
          `snapshot=$${Number(snapshot.equity_dollars || 0).toFixed(2)} computed=$${computedEquity.toFixed(2)} (diff=$${equityDiff.toFixed(2)})`,
      );
    }

    state = {
      strategy: config.strategy,
      equity_dollars: computedEquity,
      cash_dollars: computedCash,
      open_positions_count: openCount,
      allocated_notional: totalNotional,
      unrealized_pnl_dollars: totalUnrealized,
    };
  }

  console.log(
    `  Current equity: $${state.equity_dollars.toFixed(2)}, Cash: $${state.cash_dollars.toFixed(2)}`
  );
  console.log(`  Open positions: ${openCount}`);

  // 3. Update positions and check exits
  const now = new Date();
  const updatedState = await updatePositionsAndCheckExits(
    ctx,
    supabase,
    config,
    positions,
    state,
    now
  );

  // 4. Check for EOD flatten (DAYTRADE only)
  if (
    config.strategy === "DAYTRADE" &&
    now.getUTCHours() === config.eod_flatten_hour_utc &&
    now.getUTCMinutes() >= config.eod_flatten_minute_utc
  ) {
    console.log(`  🔴 EOD Flatten triggered`);
    await flattenAllPositions(ctx, supabase, config, openPositions || [], now);
    updatedState.cash_dollars = updatedState.equity_dollars;
    updatedState.allocated_notional = 0;
    updatedState.open_positions_count = 0;
    updatedState.unrealized_pnl_dollars = 0;
  }

  // 5. Scan for new signals (confidence >= 60) if trade gate allows new entries
  const tradingStyle = config.strategy === "DAYTRADE" ? "daytrade" : "swing";
  const engineType = config.strategy === "DAYTRADE" ? "DAYTRADER" : "SWING";
  const tradeGate = getTradeGateStatus(now);
  let allocationCtx: AllocationContext | null = null;
  let focusSymbols: Set<string> | null = null;
  let alwaysAllowSymbols: string[] = [];
  let portfolioGuard: PortfolioBucketGuard | null = null;

  if (config.strategy === "SWING") {
    const swingUniverse = await getLiveSwingUniverse(supabase);
    focusSymbols = swingUniverse.focusSymbols;
    allocationCtx = swingUniverse.allocationCtx;
    alwaysAllowSymbols = swingUniverse.allowlistSymbols;

    if (focusSymbols) {
      console.log(`  Focus tickers (SWING): ${focusSymbols.size} symbols`);
    }

    if (allocationCtx) {
      console.log(
        `[allocation] enabled=${allocationCtx.flags.enabled} allowlist_size=${allocationCtx.flags.allowlist.size} owners=${allocationCtx.owners.size}`,
      );
    }

    portfolioGuard = await buildPortfolioBucketGuard(supabase, {
      maxSlots: config.max_concurrent_positions,
      now,
    });

    if (portfolioGuard) {
      console.log(
        `[portfolio_guard] snapshot=${portfolioGuard.snapshotDate ?? "n/a"} candidates=${portfolioGuard.totalCandidates} coreSlots=${portfolioGuard.coreSlots} exploreSlots=${portfolioGuard.exploreSlots}`,
      );
      console.log(
        `[portfolio_guard] core symbols: ${summarizeSymbols(portfolioGuard.coreSymbols)}`,
      );
      console.log(
        `[portfolio_guard] explore symbols: ${summarizeSymbols(portfolioGuard.exploreSymbols)}`,
      );
    } else {
      console.warn("[portfolio_guard] Guard unavailable; defaulting to legacy behaviour");
    }
  }

  if (!tradeGate.allowed) {
    console.log(
      `  🚫 Trade gate closed (${tradeGate.reason}) at ${tradeGate.currentTimeET} ET – skipping new ${config.strategy} entries.`,
    );
  } else {
    // Signal freshness window: 2 hours for daytrader, 6 hours for swing
    const lookbackHours = config.strategy === "DAYTRADE" ? 2 : 6;
    const lookbackMs = lookbackHours * 60 * 60 * 1000;
    const lookbackStartIso = new Date(Date.now() - lookbackMs).toISOString();
    

    const { data: newSignals, error: signalError } = await fetchSignalsWithAllowlist(
      supabase,
      engineType,
      lookbackStartIso,
      {
        allowlistSymbols: config.strategy === 'SWING' ? alwaysAllowSymbols : [],
        allowlistBypassConfidence: alwaysAllowSymbols.length > 0,
      },
    );

    if (signalError) {
      console.error(`Error loading signals for ${config.strategy}:`, signalError);
      return;
    }

    console.log(`  New signals found: ${newSignals?.length || 0}`);
    
    // Filter signals to only TOP30 focus tickers (SWING only)
    const allowlistSymbolSet = new Set(alwaysAllowSymbols);
    const filteredSignals =
      focusSymbols === null
        ? (newSignals || [])
        : (newSignals || []).filter((s: Signal) => {
            const symbol = (s.symbol || '').toUpperCase();
            return focusSymbols!.has(symbol) || allowlistSymbolSet.has(symbol);
          });
    if (focusSymbols) {
      console.log(`  Signals in TOP30 focus list: ${filteredSignals.length}`);
    }


    // 6. Process new signals
    if (filteredSignals && filteredSignals.length > 0) {
      await processNewSignals(
        ctx,
        supabase,
        config,
        filteredSignals,
        updatedState,
        tradeGate,
        allocationCtx,
        portfolioGuard,
      );
    }
  }

  // 7. Save new portfolio state snapshot
  await savePortfolioState(ctx, supabase, config.strategy, updatedState);

  console.log(`✅ ${config.strategy} processing complete`);
}

async function updatePositionsAndCheckExits(
  ctx: EngineContext,
  supabase: any,
  config: any,
  positions: Position[],
  state: PortfolioState,
  now: Date
): Promise<PortfolioState> {
  if (positions.length === 0) {
    // No positions - return clean state with full cash
    return {
      strategy: state.strategy,
      equity_dollars: state.equity_dollars,
      cash_dollars: state.equity_dollars, // All cash available
      open_positions_count: 0,
      allocated_notional: 0,
      unrealized_pnl_dollars: 0,
    };
  }

  console.log(`  Updating ${positions.length} positions...`);

  // Fetch real-time prices from Yahoo V8
  const tickers = positions.map((p) => p.ticker);
  console.log(`  Fetching real-time prices for: ${tickers.join(", ")}`);
  
  const quotes = await fetchBulkQuotes(tickers);
  const priceMap = new Map<string, number>();
  
  // Also fetch recent 5m bars to check for intrabar TP/SL hits
  const barsMap = new Map<string, any>();
  
  for (const ticker of tickers) {
    const quote = quotes[ticker];
    if (quote?.price) {
      priceMap.set(ticker, quote.price);
      console.log(`  ${ticker}: $${quote.price.toFixed(2)}`);
    } else {
      // Fallback to position entry price if quote fails
      const pos = positions.find(p => p.ticker === ticker);
      if (pos) {
        priceMap.set(ticker, pos.entry_price);
        console.warn(`  ${ticker}: Yahoo quote failed, using entry price $${pos.entry_price.toFixed(2)}`);
      }
    }
    
    // Fetch last 10 minutes of 5m bars (2 bars) to check for TP/SL hits
    try {
      const ohlcData = await fetchIntradayOHLC({ symbol: ticker, interval: '5m', daysBack: 1 });
      if (ohlcData?.bars && ohlcData.bars.length > 0) {
        // Get last up to 8 bars for continuation evaluation and intrabar TP/SL
        const recentBars = ohlcData.bars.slice(-8);
        barsMap.set(ticker, recentBars);
      }
    } catch (error) {
      console.warn(`  ${ticker}: Failed to fetch 5m bars:`, error.message);
    }
  }

  let totalUnrealizedPnl = 0;
  let totalAllocatedNotional = 0;

  const positionsToClose: Array<{
    pos: Position;
    realizedPnl: number;
    notionalAtEntry: number;
  }> = [];

  // Capital recycling thresholds by mode (live-only optimization)
  const isStrictMode = config.capitalRecyclingMode === 'STRICT';
  const isRecyclingOn = config.capitalRecyclingMode === 'ON' || config.capitalRecyclingMode === 'STRICT';

  const MIN_RECYCLE_TIME_MIN = isStrictMode ? 120 : 60;       // minutes in trade
  const MIN_RECYCLE_R = isStrictMode ? 0.7 : 0.35;            // minimum unrealized R
  const MOMENTUM_LOOKBACK = isStrictMode ? 12 : 8;            // bars for continuationScore
  const PARTIAL_CLOSE_PCT = isStrictMode ? 0.5 : 0.6;         // fraction to close when recycling

  const LOW_CONTINUATION = 0.25;
  const LOCKED_R_BLOCK = 0.8;
  const MIN_TP_PROXIMITY_BLOCK_PCT = 25;

  for (const pos of positions) {
    const currentPrice = priceMap.get(pos.ticker) || pos.entry_price;
    const isLong = (pos as any).side ? (pos as any).side === 'LONG' : true;
    const priceDiff = isLong
      ? currentPrice - pos.entry_price
      : pos.entry_price - currentPrice;
    const unrealizedPnl = priceDiff * pos.size_shares;
    const unrealizedPnlR = unrealizedPnl / pos.risk_dollars;

    totalUnrealizedPnl += unrealizedPnl;
    totalAllocatedNotional += pos.notional_at_entry; // Just the entry notional, not including P&L

    // Trailing stop logic
    let trailingStopActive = (pos as any).trailing_stop_active || false;
    let highestPrice = (pos as any).highest_price_reached || pos.entry_price;
    let lowestPrice = (pos as any).lowest_price_reached || pos.entry_price;
    let trailingStopPrice = (pos as any).trailing_stop_price;
    let updatedStopLoss = pos.stop_loss;

    if (config.trailing_stop?.enabled) {
      const trailingRiskPerShare = Math.abs(pos.entry_price - pos.stop_loss);
      
      if (isLong) {
        // Track highest price for LONG
        if (currentPrice > highestPrice) {
          highestPrice = currentPrice;
        }
        
        // Check if we should activate trailing stop
        if (!trailingStopActive && unrealizedPnlR >= config.trailing_stop.activation_threshold_R) {
          trailingStopActive = true;
          console.log(`  📈 ${pos.ticker}: Trailing stop ACTIVATED at ${unrealizedPnlR.toFixed(2)}R profit`);
        }
        
        // Update trailing stop if active
        if (trailingStopActive) {
          trailingStopPrice = highestPrice - (config.trailing_stop.trail_distance_R * trailingRiskPerShare);
          // Ensure stop only moves up, never down
          if (trailingStopPrice > updatedStopLoss) {
            updatedStopLoss = trailingStopPrice;
            console.log(`  ↗️  ${pos.ticker}: Trailing SL updated to $${updatedStopLoss.toFixed(2)} (peak: $${highestPrice.toFixed(2)})`);
          }
        }
      } else {
        // Track lowest price for SHORT
        if (currentPrice < lowestPrice) {
          lowestPrice = currentPrice;
        }
        
        // Check if we should activate trailing stop
        if (!trailingStopActive && unrealizedPnlR >= config.trailing_stop.activation_threshold_R) {
          trailingStopActive = true;
          console.log(`  📉 ${pos.ticker}: Trailing stop ACTIVATED at ${unrealizedPnlR.toFixed(2)}R profit`);
        }
        
        // Update trailing stop if active
        if (trailingStopActive) {
          trailingStopPrice = lowestPrice + (config.trailing_stop.trail_distance_R * trailingRiskPerShare);
          // Ensure stop only moves down, never up
          if (trailingStopPrice < updatedStopLoss) {
            updatedStopLoss = trailingStopPrice;
            console.log(`  ↘️  ${pos.ticker}: Trailing SL updated to $${updatedStopLoss.toFixed(2)} (trough: $${lowestPrice.toFixed(2)})`);
          }
        }
      }
    }

    // Check exits using OHLC bars for intrabar hits
    let exitReason: string | null = null;
    let exitPrice = currentPrice;
    let exitTimestamp = now.toISOString();
    
    const recentBars = barsMap.get(pos.ticker);

    // --- Capital recycling (partial close) ---------------------------------
    let continuationScore = 0.5;
    if (recentBars && recentBars.length > 0) {
      const mappedBars = recentBars.slice(-MOMENTUM_LOOKBACK).map((b: any) => ({
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      continuationScore = computeContinuationScoreFromBars(mappedBars);
    }

    // approximate R metrics from existing fields
    const riskPerShare = Math.abs(pos.entry_price - pos.stop_loss) || 0;
    const initialRiskPrice = (pos as any).initial_risk_price || riskPerShare || null;

    let unrealizedR: number | null = null;
    let lockedR: number | null = null;
    if (initialRiskPrice && initialRiskPrice > 0) {
      unrealizedR = isLong
        ? (currentPrice - pos.entry_price) / initialRiskPrice
        : (pos.entry_price - currentPrice) / initialRiskPrice;

      lockedR = isLong
        ? (updatedStopLoss - pos.entry_price) / initialRiskPrice
        : (pos.entry_price - updatedStopLoss) / initialRiskPrice;
    }

    const distanceToTpPct = computeDistanceToTp1RemainingPct(pos, currentPrice, isLong);
    const timeInMinutes = (now.getTime() - new Date(pos.entry_timestamp).getTime()) / (60 * 1000);
    const hasRecycled = Boolean((pos as any).has_recycled_capital);

    // Debug logging for sideways time-exit behaviour (helps understand why a position was NOT closed)
    if (config.strategy === 'SWING') {
      console.log(
        `  [TIME-EXIT DEBUG] ${pos.ticker}: R=${unrealizedR?.toFixed(2) ?? 'n/a'}, time=${timeInMinutes.toFixed(
          1,
        )}min, continuation=${continuationScore.toFixed(2)}, now_utc=${now.toISOString()}`,
      );
    }

    // Pre-close time-exit for sideways profitable trades (SWING only)
    // Close full position ~15 minutes before US close if in solid profit and momentum has stalled.
    let timeExitTriggered = false;
    if (config.strategy === 'SWING') {
      const nowUtc = now;
      const isPreCloseWindow = nowUtc.getUTCHours() === 20 && nowUtc.getUTCMinutes() >= 45;
      const MIN_TIME_EXIT_R = 0.6; // minimum unrealized R to consider time-exit
      const MIN_TIME_EXIT_MINUTES = 120; // at least 2 hours in trade
      const LOW_CONTINUATION_EXIT = 0.3; // slightly looser than recycle

      if (
        isPreCloseWindow &&
        unrealizedR != null &&
        unrealizedR >= MIN_TIME_EXIT_R &&
        timeInMinutes >= MIN_TIME_EXIT_MINUTES &&
        continuationScore < LOW_CONTINUATION_EXIT
      ) {
        exitReason = 'TIME_EXIT_PRE_CLOSE_SIDEWAYS';
        exitPrice = currentPrice;
        exitTimestamp = nowUtc.toISOString();
        timeExitTriggered = true;
        console.log(
          `  🕒 TIME EXIT ${pos.ticker}: closing full position @ $${exitPrice.toFixed(
            2,
          )} (R=${unrealizedR.toFixed(2)}) before market close due to sideways action`,
        );
      }
    }

    // Hard SL safety: never recycle if SL is still on the risk side of entry
    const hasSafeStop = isLong
      ? updatedStopLoss >= pos.entry_price
      : updatedStopLoss <= pos.entry_price;

    const canRecycle =
      isRecyclingOn &&
      config.allowCapitalRecycling &&
      !config.isTrendFollower &&
      !hasRecycled &&
      hasSafeStop &&
      unrealizedR != null &&
      lockedR != null &&
      unrealizedR > 0 &&
      timeInMinutes >= MIN_RECYCLE_TIME_MIN &&
      unrealizedR >= MIN_RECYCLE_R &&
      continuationScore < LOW_CONTINUATION &&
      lockedR < LOCKED_R_BLOCK &&
      (distanceToTpPct == null || distanceToTpPct >= MIN_TP_PROXIMITY_BLOCK_PCT) &&
      !(config.enableTp2 && pos.tp1_hit);  // BLOCK recycling if runner is active

    // If a pre-close time exit has already decided to close this position, skip recycling logic
    if (!timeExitTriggered && canRecycle) {
      const closeShares = Math.floor(pos.size_shares * PARTIAL_CLOSE_PCT);
      if (closeShares > 0 && closeShares < pos.size_shares) {
        const exitPrice = currentPrice;
        const exitDiff = isLong
          ? exitPrice - pos.entry_price
          : pos.entry_price - exitPrice;
        const realizedPnl = exitDiff * closeShares;
        const realizedR = realizedPnl / pos.risk_dollars;

        console.log(
          `  ♻️ Capital recycle ${pos.ticker}: closing ${closeShares} of ${pos.size_shares} shares at $${exitPrice.toFixed(2)} (R=${realizedR.toFixed(2)})`,
        );

        assertRunMode(ctx, 'PRIMARY', 'insert partial recycle into live_trades');
        await supabase.from('live_trades').insert({
          strategy: pos.strategy,
          ticker: pos.ticker,
          side: (pos as any).side || 'LONG',
          signal_id: pos.signal_id,
          engine_key: pos.engine_key || ctx.engineKey,
          engine_version: pos.engine_version,
          entry_timestamp: pos.entry_timestamp,
          entry_price: pos.entry_price,
          size_shares: closeShares,
          notional_at_entry: (pos.notional_at_entry * closeShares) / pos.size_shares,
          exit_timestamp: now.toISOString(),
          exit_price: exitPrice,
          exit_reason: 'CAPITAL_RECYCLE_LOW_MOMENTUM',
          stop_loss: pos.stop_loss,
          take_profit: pos.take_profit,
          risk_dollars: (pos.risk_dollars * closeShares) / pos.size_shares,
          risk_r: pos.risk_r,
          realized_pnl_dollars: realizedPnl,
          realized_pnl_r: realizedR,
        });

        // trade_logs is diagnostic; still PRIMARY-only today
        assertRunMode(ctx, 'PRIMARY', 'insert into trade_logs (partial recycle)');
        await supabase.from('trade_logs').insert({
          position_id: pos.id,
          signal_id: pos.signal_id,
          strategy: pos.strategy,
          ticker: pos.ticker,
          log_type: 'EXIT',
          exit_reason: 'CAPITAL_RECYCLE_LOW_MOMENTUM',
          exit_subtype: 'PARTIAL',
          realized_pnl_usd: realizedPnl,
          realized_R: realizedR,
          metadata: {
            time_in_trade_minutes: timeInMinutes,
            unrealized_R_at_decision: unrealizedR,
            locked_R_at_decision: lockedR,
            continuationScore,
            active_stop_loss: updatedStopLoss,
            executed_entry_price: pos.entry_price,
            current_price: currentPrice,
            tp1_price: pos.take_profit,
            sl_price_initial: pos.stop_loss,
            pct_closed: PARTIAL_CLOSE_PCT,
            slotPressure: false,
          },
        });

        const remainingShares = pos.size_shares - closeShares;
        const remainingNotional = (pos.notional_at_entry * remainingShares) / pos.size_shares;
        const remainingRiskDollars = (pos.risk_dollars * remainingShares) / pos.size_shares;

        assertRunMode(ctx, 'PRIMARY', 'update live_positions after partial recycle');
        await supabase
          .from('live_positions')
          .update({
            size_shares: remainingShares,
            notional_at_entry: remainingNotional,
            risk_dollars: remainingRiskDollars,
            has_recycled_capital: true,
          })
          .eq('id', pos.id);

        // update local snapshot so the rest of the loop uses the reduced position
        pos.size_shares = remainingShares;
        pos.notional_at_entry = remainingNotional;
        pos.risk_dollars = remainingRiskDollars;
        (pos as any).has_recycled_capital = true;
      }
    }

    // --- TP2 Runner Logic (BEFORE standard TP/SL checks) --------------------------
    if (config.enableTp2 && pos.tp1_price && pos.tp2_price && !pos.tp1_hit) {
      // Check if TP1 was hit - trigger partial close
      let tp1HitInBar = false;
      let tp1HitPrice = pos.tp1_price;
      let tp1HitTimestamp = now.toISOString();
      
      if (recentBars && recentBars.length > 0) {
        for (const bar of recentBars) {
          if (isLong && bar.high >= pos.tp1_price) {
            tp1HitInBar = true;
            tp1HitTimestamp = bar.timestamp;
            break;
          } else if (!isLong && bar.low <= pos.tp1_price) {
            tp1HitInBar = true;
            tp1HitTimestamp = bar.timestamp;
            break;
          }
        }
      }
      
      // Fallback to current price
      const tp1HitByPrice = isLong ? currentPrice >= pos.tp1_price : currentPrice <= pos.tp1_price;
      
      if (tp1HitInBar || tp1HitByPrice) {
        // TP1 hit - execute partial close
        const closeShares = Math.floor(pos.size_shares * config.tp1ClosePct);
        const remainingShares = pos.size_shares - closeShares;
        
        if (closeShares > 0 && remainingShares > 0) {
          const exitPrice = tp1HitPrice;
          const exitDiff = isLong
            ? exitPrice - pos.entry_price
            : pos.entry_price - exitPrice;
          const partialPnl = exitDiff * closeShares;
          const partialPnlR = partialPnl / (pos.risk_dollars * closeShares / pos.size_shares);
          
          console.log(
            `  🎯 TP1 HIT ${pos.ticker}: Closing ${closeShares} of ${pos.size_shares} shares @ $${exitPrice.toFixed(2)} (${(config.tp1ClosePct * 100)}%), keeping ${remainingShares} shares as runner to TP2=$${pos.tp2_price.toFixed(2)}`
          );
          
          // Record partial exit
          assertRunMode(ctx, 'PRIMARY', 'insert TP1_PARTIAL into live_trades');
          await supabase.from('live_trades').insert({
            strategy: pos.strategy,
            ticker: pos.ticker,
            side: (pos as any).side || 'LONG',
            signal_id: pos.signal_id,
            engine_key: pos.engine_key || ctx.engineKey,
            engine_version: pos.engine_version,
            entry_timestamp: pos.entry_timestamp,
            entry_price: pos.entry_price,
            size_shares: closeShares,
            notional_at_entry: (pos.notional_at_entry * closeShares) / pos.size_shares,
            exit_timestamp: tp1HitTimestamp,
            exit_price: exitPrice,
            exit_reason: 'TP1_PARTIAL',
            stop_loss: pos.stop_loss,
            take_profit: pos.tp1_price,
            risk_dollars: (pos.risk_dollars * closeShares) / pos.size_shares,
            risk_r: pos.risk_r,
            realized_pnl_dollars: partialPnl,
            realized_pnl_r: partialPnlR,
            is_tp1_exit: true,
          });
          
          // Update position: reduce size, mark TP1 hit, activate runner
          const remainingNotional = (pos.notional_at_entry * remainingShares) / pos.size_shares;
          const remainingRiskDollars = (pos.risk_dollars * remainingShares) / pos.size_shares;
          
          // Move SL to breakeven if configured
          let newStopLoss = updatedStopLoss;
          if (config.moveSlToBreakeven) {
            newStopLoss = pos.entry_price;
            console.log(`  🔒 Moving SL to breakeven: $${newStopLoss.toFixed(2)}`);
          }
          
          assertRunMode(ctx, 'PRIMARY', 'update live_positions after TP1 partial');
          await supabase
            .from('live_positions')
            .update({
              size_shares: remainingShares,
              notional_at_entry: remainingNotional,
              risk_dollars: remainingRiskDollars,
              tp1_hit: true,
              runner_active: true,
              stop_loss: newStopLoss,
              take_profit: pos.tp2_price,  // Now targeting TP2
            })
            .eq('id', pos.id);
          
          // Update local state for this loop iteration
          pos.size_shares = remainingShares;
          pos.notional_at_entry = remainingNotional;
          pos.risk_dollars = remainingRiskDollars;
          pos.tp1_hit = true;
          pos.runner_active = true;
          pos.stop_loss = newStopLoss;
          pos.take_profit = pos.tp2_price;
          updatedStopLoss = newStopLoss;
        }
      }
    }
    
    // Check if runner hit TP2 or trailing stop
    if (config.enableTp2 && pos.runner_active && pos.tp2_price) {
      let runnerExit = false;
      let runnerExitReason = null;
      
      if (recentBars && recentBars.length > 0) {
        for (const bar of recentBars) {
          if (isLong) {
            if (bar.high >= pos.tp2_price && !runnerExit) {
              exitReason = "TP2_HIT";
              exitPrice = pos.tp2_price;
              exitTimestamp = bar.timestamp;
              runnerExit = true;
              console.log(`  🏆 ${pos.ticker}: TP2 hit in bar (high=${bar.high.toFixed(2)} >= TP2=${pos.tp2_price.toFixed(2)})`);
              break;
            }
            if (bar.low <= updatedStopLoss && !runnerExit) {
              exitReason = "RUNNER_TRAIL_EXIT";
              exitPrice = updatedStopLoss;
              exitTimestamp = bar.timestamp;
              runnerExit = true;
              console.log(`  🛑 ${pos.ticker}: Runner stopped in bar (low=${bar.low.toFixed(2)} <= SL=${updatedStopLoss.toFixed(2)})`);
              break;
            }
          } else {
            if (bar.low <= pos.tp2_price && !runnerExit) {
              exitReason = "TP2_HIT";
              exitPrice = pos.tp2_price;
              exitTimestamp = bar.timestamp;
              runnerExit = true;
              console.log(`  🏆 ${pos.ticker}: TP2 hit in bar (low=${bar.low.toFixed(2)} <= TP2=${pos.tp2_price.toFixed(2)})`);
              break;
            }
            if (bar.high >= updatedStopLoss && !runnerExit) {
              exitReason = "RUNNER_TRAIL_EXIT";
              exitPrice = updatedStopLoss;
              exitTimestamp = bar.timestamp;
              runnerExit = true;
              console.log(`  🛑 ${pos.ticker}: Runner stopped in bar (high=${bar.high.toFixed(2)} >= SL=${updatedStopLoss.toFixed(2)})`);
              break;
            }
          }
        }
      }
      
      // Fallback to current price
      if (!runnerExit) {
        if (isLong) {
          if (currentPrice >= pos.tp2_price) {
            exitReason = "TP2_HIT";
            exitPrice = pos.tp2_price;
            runnerExit = true;
          } else if (currentPrice <= updatedStopLoss) {
            exitReason = "RUNNER_TRAIL_EXIT";
            exitPrice = updatedStopLoss;
            runnerExit = true;
          }
        } else {
          if (currentPrice <= pos.tp2_price) {
            exitReason = "TP2_HIT";
            exitPrice = pos.tp2_price;
            runnerExit = true;
          } else if (currentPrice >= updatedStopLoss) {
            exitReason = "RUNNER_TRAIL_EXIT";
            exitPrice = updatedStopLoss;
            runnerExit = true;
          }
        }
      }
    }
    
    // --- Standard TP/SL checks (only if TP2 is disabled or not hit yet) -----------
    if (!config.enableTp2 || !pos.runner_active) {
      if (recentBars && recentBars.length > 0) {
        // Check if TP or SL was hit in recent bars
        for (const bar of recentBars) {
          if (isLong) {
            // LONG: Check if bar high hit TP or bar low hit SL
            if (bar.high >= pos.take_profit && !exitReason) {
              exitReason = "TP_HIT";
              exitPrice = pos.take_profit; // Exit at TP price
              exitTimestamp = bar.timestamp; // Use bar timestamp
              console.log(`  🎯 ${pos.ticker}: TP hit in bar (high=${bar.high.toFixed(2)} >= TP=${pos.take_profit.toFixed(2)})`);
              break;
            }
            if (bar.low <= updatedStopLoss && !exitReason) {
              exitReason = trailingStopActive ? "TRAILING_SL_HIT" : "SL_HIT";
              exitPrice = updatedStopLoss; // Exit at SL price
              exitTimestamp = bar.timestamp;
              console.log(`  🛑 ${pos.ticker}: ${exitReason} in bar (low=${bar.low.toFixed(2)} <= SL=${updatedStopLoss.toFixed(2)}, trailingActive=${trailingStopActive})`);
              break;
            }
          } else {
            // SHORT: Check if bar low hit TP or bar high hit SL
            if (bar.low <= pos.take_profit && !exitReason) {
              exitReason = "TP_HIT";
              exitPrice = pos.take_profit; // Exit at TP price
              exitTimestamp = bar.timestamp;
              console.log(`  🎯 ${pos.ticker}: TP hit in bar (low=${bar.low.toFixed(2)} <= TP=${pos.take_profit.toFixed(2)})`);
              break;
            }
            if (bar.high >= updatedStopLoss && !exitReason) {
              exitReason = trailingStopActive ? "TRAILING_SL_HIT" : "SL_HIT";
              exitPrice = updatedStopLoss; // Exit at SL price
              exitTimestamp = bar.timestamp;
              console.log(`  🛑 ${pos.ticker}: ${exitReason} in bar (high=${bar.high.toFixed(2)} >= SL=${updatedStopLoss.toFixed(2)}, trailingActive=${trailingStopActive})`);
              break;
            }
          }
        }
      }
    }
    
    // Fallback to current price check if no bars or no intrabar hit
    if (!exitReason) {
      if (isLong) {
        if (currentPrice >= pos.take_profit) {
          exitReason = "TP_HIT";
          exitPrice = pos.take_profit;
        } else if (currentPrice <= updatedStopLoss) {
          exitReason = trailingStopActive ? "TRAILING_SL_HIT" : "SL_HIT";
          exitPrice = updatedStopLoss;
          console.log(`  🛑 ${pos.ticker}: ${exitReason} at current price (${currentPrice.toFixed(2)} <= SL=${updatedStopLoss.toFixed(2)}, trailingActive=${trailingStopActive})`);
        }
      } else {
        // SHORT: TP below entry, SL above entry
        if (currentPrice <= pos.take_profit) {
          exitReason = "TP_HIT";
          exitPrice = pos.take_profit;
        } else if (currentPrice >= updatedStopLoss) {
          exitReason = trailingStopActive ? "TRAILING_SL_HIT" : "SL_HIT";
          exitPrice = updatedStopLoss;
          console.log(`  🛑 ${pos.ticker}: ${exitReason} at current price (${currentPrice.toFixed(2)} >= SL=${updatedStopLoss.toFixed(2)}, trailingActive=${trailingStopActive})`);
        }
      }
    }

    if (exitReason) {
      console.log(
        `  🎯 Closing ${pos.ticker} @ $${exitPrice.toFixed(2)} (${exitReason})`
      );
      // Calculate P&L using exit price (not current price)
      const exitPriceDiff = isLong
        ? exitPrice - pos.entry_price
        : pos.entry_price - exitPrice;
      const realizedPnl = exitPriceDiff * pos.size_shares;
      const realizedPnlR = realizedPnl / pos.risk_dollars;

      positionsToClose.push({
        pos,
        realizedPnl,
        notionalAtEntry: pos.notional_at_entry,
      });

      // Record closed trade
      assertRunMode(ctx, 'PRIMARY', 'insert closed trade into live_trades');
      await supabase.from("live_trades").insert({
        strategy: pos.strategy,
        ticker: pos.ticker,
        side: (pos as any).side || 'LONG',  // Include side field
        signal_id: pos.signal_id,
      engine_key: pos.engine_key || ctx.engineKey,
        engine_key: pos.engine_key || ctx.engineKey,
        engine_version: pos.engine_version,
        entry_timestamp: pos.entry_timestamp,
        entry_price: pos.entry_price,
        size_shares: pos.size_shares,
        notional_at_entry: pos.notional_at_entry,
        exit_timestamp: exitTimestamp,
        exit_price: exitPrice,
        exit_reason: exitReason,
        stop_loss: pos.stop_loss,
        take_profit: pos.take_profit,
        risk_dollars: pos.risk_dollars,
        risk_r: pos.risk_r,
        realized_pnl_dollars: realizedPnl,
        realized_pnl_r: realizedPnlR,
        is_tp2_exit: exitReason === 'TP2_HIT',
        is_runner_exit: exitReason === 'RUNNER_TRAIL_EXIT',
      });

      // Delete from open positions
      assertRunMode(ctx, 'PRIMARY', 'delete closed position from live_positions');
      await supabase.from("live_positions").delete().eq("id", pos.id);
    } else {
      // Update position with current price and trailing stop fields
      assertRunMode(ctx, 'PRIMARY', 'update open position in live_positions');
      await supabase
        .from("live_positions")
        .update({
          current_price: currentPrice,
          unrealized_pnl_dollars: unrealizedPnl,
          unrealized_pnl_r: unrealizedPnlR,
          stop_loss: updatedStopLoss,
          trailing_stop_active: trailingStopActive,
          highest_price_reached: highestPrice,
          lowest_price_reached: lowestPrice,
          trailing_stop_price: trailingStopPrice,
          last_updated: now.toISOString(),
        })
        .eq("id", pos.id);
    }
  }

  // Calculate new state
  // IMPORTANT: the Live Trading UI uses equity snapshots from live_portfolio_state.
  // We must ensure realized P&L from closed trades is reflected in cash/equity, and
  // allocated/unrealized totals only include remaining open positions.

  // 1) Update cash by returning notional + realized P&L for each closed position
  const newCash = state.cash_dollars + positionsToClose.reduce(
    (sum, c) => sum + c.notionalAtEntry + c.realizedPnl,
    0,
  );

  // 2) Recompute open positions totals from DB (source of truth)
  const { data: remainingOpenPositions, error: remainingPosError } = await supabase
    .from('live_positions')
    .select('notional_at_entry, unrealized_pnl_dollars, strategy')
    .eq('strategy', state.strategy);

  if (remainingPosError) {
    console.error('[model_portfolio_manager] Error refetching remaining open positions:', remainingPosError);
    // Fallback to the (potentially stale) in-memory totals
    const remainingPositions = positions.length - positionsToClose.length;
    const newEquityFallback = newCash + totalAllocatedNotional + totalUnrealizedPnl;

    return {
      strategy: state.strategy,
      equity_dollars: newEquityFallback,
      cash_dollars: newCash,
      open_positions_count: remainingPositions,
      allocated_notional: totalAllocatedNotional,
      unrealized_pnl_dollars: totalUnrealizedPnl,
    };
  }

  const allocatedNotional = (remainingOpenPositions || []).reduce(
    (sum, p) => sum + Number(p.notional_at_entry ?? 0),
    0,
  );

  const unrealizedPnl = (remainingOpenPositions || []).reduce(
    (sum, p) => sum + Number(p.unrealized_pnl_dollars ?? 0),
    0,
  );

  const remainingCount = (remainingOpenPositions || []).length;

  // 3) Equity = cash + allocated notional + unrealized P&L
  const newEquity = newCash + allocatedNotional + unrealizedPnl;

  return {
    strategy: state.strategy,
    equity_dollars: newEquity,
    cash_dollars: newCash,
    open_positions_count: remainingCount,
    allocated_notional: allocatedNotional,
    unrealized_pnl_dollars: unrealizedPnl,
  };
}

async function flattenAllPositions(
  ctx: EngineContext,
  supabase: any,
  config: any,
  positions: Position[],
  now: Date
) {
  console.log(`  Flattening ${positions.length} positions for EOD...`);

  for (const pos of positions) {
    // Use last known price or entry price
    const exitPrice = pos.current_price || pos.entry_price;
    const isLong = (pos as any).side ? (pos as any).side === 'LONG' : true;
    const priceDiff = isLong
      ? exitPrice - pos.entry_price
      : pos.entry_price - exitPrice;
    const realizedPnl = priceDiff * pos.size_shares;
    const realizedPnlR = realizedPnl / pos.risk_dollars;

    assertRunMode(ctx, 'PRIMARY', 'insert EOD_FLATTEN into live_trades');
    await supabase.from("live_trades").insert({
      strategy: pos.strategy,
      ticker: pos.ticker,
      side: (pos as any).side || 'LONG',  // Include side field
      signal_id: pos.signal_id,
      engine_key: pos.engine_key || ctx.engineKey,
      engine_version: pos.engine_version,
      entry_timestamp: pos.entry_timestamp,
      entry_price: pos.entry_price,
      size_shares: pos.size_shares,
      notional_at_entry: pos.notional_at_entry,
      exit_timestamp: now.toISOString(),
      exit_price: exitPrice,
      exit_reason: "EOD_FLATTEN",
      stop_loss: pos.stop_loss,
      take_profit: pos.take_profit,
      risk_dollars: pos.risk_dollars,
      risk_r: pos.risk_r,
      realized_pnl_dollars: realizedPnl,
      realized_pnl_r: realizedPnlR,
    });

    assertRunMode(ctx, 'PRIMARY', 'delete EOD position from live_positions');
    await supabase.from("live_positions").delete().eq("id", pos.id);
  }
}

/**
 * Shadow-specific signal processing.
 * Writes to engine_positions (not live_positions) and respects promotion gating.
 */
async function processShadowSignals(
  ctx: EngineContext,
  supabase: any,
  config: any,
  signals: Signal[],
  state: PortfolioState
) {
  console.log(`[shadow] Processing ${signals.length} signals for ${ctx.engineVersion}...`);
  const gateMeta = {
    engineVersion: ctx.engineVersion,
    runMode: ctx.runMode,
  };

  // Load existing shadow positions to check for duplicates
  const { data: existingPositions } = await supabase
    .from("engine_positions")
    .select("ticker")
    .eq("engine_key", ctx.engineKey)
    .eq("engine_version", ctx.engineVersion)
    .eq("run_mode", ctx.runMode)
    .eq("status", "OPEN");

  const existingTickers = new Set(
    (existingPositions || []).map((p: any) => p.ticker)
  );

  // Load promoted tickers if this engine requires gating. SWING_V2_ROBUST
  // now trades the full whitelist universe like the baseline engine, so it is
  // no longer promotion-gated.
  const PROMOTION_GATED_ENGINES = new Set(['SWING_V1_12_15DEC', 'SWING_FAV8_SHADOW']);
  let promotedTickers: Set<string> | null = null;
  if (PROMOTION_GATED_ENGINES.has(ctx.engineVersion)) {
    const { data: promoted, error: promotedErr } = await supabase
      .from('promoted_tickers')
      .select('ticker')
      .eq('engine_version', ctx.engineVersion)
      .gte('is_promoted', true);

    if (promotedErr) {
      console.warn('[shadow] Failed to load promoted_tickers:', promotedErr.message ?? promotedErr);
      promotedTickers = null; // fallback: allow all tickers so shadow can still trade
    } else if (promoted && promoted.length > 0) {
      promotedTickers = new Set(promoted.map((r: any) => r.ticker));
      console.log(`[shadow] ${ctx.engineVersion}: promotion gating with ${promotedTickers.size} tickers`);
    } else {
      console.log(`[shadow] ${ctx.engineVersion}: no promoted tickers configured, disabling gating`);
      promotedTickers = null; // no gating when list empty
    }
  }

  for (const signal of signals) {
    const ticker = signal.symbol;
    const engineKeyForTrade = ctx.engineKey;
    const engineVersionForTrade = ctx.engineVersion;

    console.log(
      `[shadow]   ▶ Evaluating ${ticker} | conf=${signal.confidence_score} entry=${signal.entry_price} SL=${signal.stop_loss} TP1=${signal.take_profit_1}`
    );

    // Promotion-gated engines: skip non-promoted tickers
    if (promotedTickers !== null && !promotedTickers.has(ticker)) {
      console.log(`[shadow]   ⏭️  Skipping ${ticker} - not in promoted ticker list for ${ctx.engineVersion}`);
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_UNPROMOTED',
        context: { engine_version: ctx.engineVersion },
      });
      continue;
    }

    // Skip if already have position in this ticker
    if (existingTickers.has(ticker)) {
      console.log(`[shadow]   ⏭️  Skipping ${ticker} - position already open`);
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_EXISTING_POSITION',
        ...gateMeta,
      });
      continue;
    }

    // Skip if max concurrent positions reached
    if (state.open_positions_count >= config.max_concurrent_positions) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - max concurrent positions reached`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_MAX_POSITIONS',
        ...gateMeta,
      });
      continue;
    }

    // Validate risk/reward ratio (minimum 0.5R)
    const riskPerShare = Math.abs(signal.entry_price - signal.stop_loss);
    const rewardPerShare = Math.abs(signal.take_profit_1 - signal.entry_price);
    const riskRewardRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

    // Validate reasonable distances using ATR-based guardrails
    const distanceValidation = await validateSignalDistanceWithATR(ticker, signal, riskRewardRatio);
    if (distanceValidation) {
      const contextReason = (distanceValidation.context as any).reason || 'unrealistic distance';
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - ${contextReason}. Details: ${JSON.stringify(distanceValidation.context)}`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: distanceValidation.decision,
        riskRewardRatio,
        context: distanceValidation.context,
        ...gateMeta,
      });
      continue;
    }

    if (riskRewardRatio < 0.5) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - R:R too low (${riskRewardRatio.toFixed(2)}R)`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_RR_TOO_LOW',
        riskRewardRatio,
        context: {
          risk_per_share: riskPerShare,
          reward_per_share: rewardPerShare,
        },
        ...gateMeta,
      });
      continue;
    }

    // Calculate position size
    const positionSize = calculatePositionSize(config, signal, state);

    if (positionSize === null) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - insufficient capacity or below min threshold`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_CAPACITY',
        ...gateMeta,
      });
      continue;
    }

    // Fetch current price for entry
    const currentQuote = await fetchBulkQuotes([ticker]);
    const currentPrice = currentQuote[ticker]?.price;
    
    if (!currentPrice) {
      console.warn(`[shadow]   ⚠️  ${ticker}: Failed to get real-time price, skipping`);
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_PRICE_FETCH_ERROR',
        context: { reason: 'no_current_price' },
        ...gateMeta,
      });
      continue;
    }

    // Validate signal freshness: reject if price has moved >1.5% from signal entry
    const priceDeviation = Math.abs(currentPrice - signal.entry_price) / signal.entry_price;
    if (priceDeviation > 0.015) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - signal stale (deviation=${(priceDeviation * 100).toFixed(2)}%)`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_STALE_ENTRY',
        entryPriceAtDecision: currentPrice,
        context: {
          deviation_pct: priceDeviation * 100,
        },
      });
      continue;
    }

    const entryPrice = currentPrice;
    
    // Determine side (LONG/SHORT) from signal decision
    const decision = (signal.ai_decision || signal.signal_type || 'buy').toLowerCase();
    const side = decision === 'sell' ? 'SHORT' : 'LONG';

    // Sanity check: SL must be on the correct side of entry (loss direction)
    if (side === 'LONG' && signal.stop_loss >= entryPrice) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - LONG SL (${signal.stop_loss}) not below entry`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_SL',
        entryPriceAtDecision: entryPrice,
        context: { side, stop_loss: signal.stop_loss },
        ...gateMeta,
      });
      continue;
    }
    if (side === 'SHORT' && signal.stop_loss <= entryPrice) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - SHORT SL (${signal.stop_loss}) not above entry`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_SL',
        entryPriceAtDecision: entryPrice,
        context: { side, stop_loss: signal.stop_loss },
        ...gateMeta,
      });
      continue;
    }

    // Sanity check: TP must be on the correct side of entry (profit direction)
    if (side === 'LONG' && signal.take_profit_1 <= entryPrice) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - LONG TP (${signal.take_profit_1}) not above entry`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_TP',
        entryPriceAtDecision: entryPrice,
        context: { side, tp1: signal.take_profit_1 },
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
        ...gateMeta,
      });
      continue;
    }
    if (side === 'SHORT' && signal.take_profit_1 >= entryPrice) {
      console.log(
        `[shadow]   ⏭️  Skipping ${ticker} - SHORT TP (${signal.take_profit_1}) not below entry`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_TP',
        entryPriceAtDecision: entryPrice,
        context: { side, tp1: signal.take_profit_1 },
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
        ...gateMeta,
      });
      continue;
    }
    
    // Open shadow position
    console.log(
      `[shadow]   ✅ Opening ${ticker} (${side}) - ${positionSize.size_shares} shares @ $${entryPrice.toFixed(2)}`
    );
    await logSignalDecision(ctx, supabase, {
      signal,
      config,
      state,
      decision: 'OPEN',
      entryPriceAtDecision: entryPrice,
      riskRewardRatio,
      engineKey: engineKeyForTrade,
      engineVersion: engineVersionForTrade,
      publishConfidence: signal.confidence_score ?? null,
      ...gateMeta,
    });
    
    assertRunMode(ctx, 'SHADOW', 'insert new position into engine_positions');
    const { error: insertError } = await supabase.from("engine_positions").insert({
      engine_key: ctx.engineKey,
      engine_version: ctx.engineVersion,
      run_mode: ctx.runMode,
      ticker: ticker,
      side,
      qty: positionSize.size_shares,
      entry_price: entryPrice,
      stop_loss: signal.stop_loss,
      take_profit: signal.take_profit_1,
      opened_at: new Date().toISOString(),
      status: 'OPEN',
      // Store notional and risk for exits
      notional_at_entry: positionSize.notional,
      risk_dollars: positionSize.risk_dollars,
    });

    if (insertError) {
      console.error(`[shadow]   ❌ Failed to insert ${ticker}:`, insertError);
      continue;
    }

    // Update state ONLY if INSERT succeeded
    state.cash_dollars -= positionSize.notional;
    state.allocated_notional += positionSize.notional;
    state.open_positions_count += 1;
    existingTickers.add(ticker);
  }
}

/**
 * Shadow-specific position management and exit logic.
 * Writes to engine_trades (not live_trades) when closing positions.
 */
async function updateShadowPositionsAndCheckExits(
  ctx: EngineContext,
  supabase: any,
  config: any,
  positions: any[],
  state: PortfolioState,
  now: Date
): Promise<PortfolioState> {
  if (positions.length === 0) {
    return {
      strategy: state.strategy,
      equity_dollars: state.equity_dollars,
      cash_dollars: state.equity_dollars,
      open_positions_count: 0,
      allocated_notional: 0,
      unrealized_pnl_dollars: 0,
    };
  }

  console.log(`[shadow]   Updating ${positions.length} shadow positions...`);

  // Fetch real-time prices
  const tickers = positions.map((p: any) => p.ticker);
  const quotes = await fetchBulkQuotes(tickers);
  const priceMap = new Map<string, number>();
  
  for (const ticker of tickers) {
    const quote = quotes[ticker];
    if (quote?.price) {
      priceMap.set(ticker, quote.price);
    } else {
      const pos = positions.find((p: any) => p.ticker === ticker);
      if (pos) {
        priceMap.set(ticker, pos.entry_price);
      }
    }
  }

  let totalUnrealizedPnl = 0;
  let totalAllocatedNotional = 0;

  const positionsToClose: Array<{
    pos: any;
    realizedPnl: number;
    notionalAtEntry: number;
    exitPrice: number;
    exitReason: string;
  }> = [];

  // Get V2-specific config overrides
  const engineOverrides = getEngineConfig(ctx.engineVersion);

  for (const pos of positions) {
    const currentPrice = priceMap.get(pos.ticker) || pos.entry_price;
    const isLong = pos.side === 'LONG';
    const priceDiff = isLong
      ? currentPrice - pos.entry_price
      : pos.entry_price - currentPrice;
    const unrealizedPnl = priceDiff * pos.qty;
    const riskDollars = pos.risk_dollars || (Math.abs(pos.entry_price - pos.stop_loss) * pos.qty);
    const unrealizedPnlR = unrealizedPnl / riskDollars;

    totalUnrealizedPnl += unrealizedPnl;
    totalAllocatedNotional += pos.notional_at_entry || (pos.qty * pos.entry_price);

    // Check for exits (TP/SL)
    let exitReason: string | null = null;
    let exitPrice = currentPrice;

    if (isLong) {
      if (currentPrice >= pos.take_profit) {
        exitReason = 'TP_HIT';
        exitPrice = pos.take_profit;
      } else if (currentPrice <= pos.stop_loss) {
        exitReason = 'SL_HIT';
        exitPrice = pos.stop_loss;
      }
    } else {
      if (currentPrice <= pos.take_profit) {
        exitReason = 'TP_HIT';
        exitPrice = pos.take_profit;
      } else if (currentPrice >= pos.stop_loss) {
        exitReason = 'SL_HIT';
        exitPrice = pos.stop_loss;
      }
    }

  // V2-specific exit logic (time exits + overnight hygiene)
    if (!exitReason && ctx.engineVersion === 'SWING_V2_ROBUST') {
      const entryTime = new Date(pos.opened_at).getTime();
      const timeInMinutes = (now.getTime() - entryTime) / (1000 * 60);
      const nowUtc = now;
      
      // Check for overnight hygiene rule (partial close + risk removal)
      const hygieneCtx: OvernightHygieneContext = {
        engineVersion: ctx.engineVersion,
        runMode: ctx.runMode,
        nowUtc,
      };
      
      const hygieneResults = await evaluateOvernightHygiene(pos, currentPrice, hygieneCtx);
      
      if (hygieneResults && hygieneResults.length > 0) {
        // Log overnight hygiene actions (PARTIAL_CLOSE, MOVE_SL_BE, ACTIVATE_ATR_TSL)
        for (const result of hygieneResults) {
          console.log(
            `[shadow]   🌙 OVERNIGHT_HYGIENE ${pos.ticker}: ${result.action} | ` +
            `unrealizedR=${result.metadata?.unrealized_R?.toFixed(2)} | ` +
            `TP1_R=${result.metadata?.TP1_R?.toFixed(2)}`
          );
          
          // Log to decision log for audit trail
          await logSignalDecision(ctx, supabase, {
            signal: {
              id: `overnight_hygiene_${pos.ticker}_${Date.now()}`,
              symbol: pos.ticker,
              trading_style: 'swing',
              engine_type: 'SWING',
              signal_type: 'neutral',
              confidence_score: 0,
              entry_price: pos.entry_price,
              stop_loss: pos.stop_loss,
              take_profit_1: pos.take_profit,
              engine_version: ctx.engineVersion,
              created_at: new Date().toISOString(),
            } as any,
            config: SWING_CONFIG,
            state: state,
            decision: `OVERNIGHT_HYGIENE_${result.action}`,
            context: result.metadata,
          });
        }
        
        // Handle partial close if triggered
        const partialClose = hygieneResults.find(r => r.action === 'PARTIAL_CLOSE');
        const slMove = hygieneResults.find(r => r.action === 'MOVE_SL_BE');
        const atrTsl = hygieneResults.find(r => r.action === 'ACTIVATE_ATR_TSL');
        
        if (partialClose) {
          // Close 50% of position at current price
          const partialQty = pos.qty * 0.5;
          const partialNotional = partialQty * currentPrice;
          const partialPnl = (currentPrice - pos.entry_price) * partialQty;
          const partialPnlR = partialPnl / (pos.risk_dollars || 1);
          
          // Insert partial close trade
          assertRunMode(ctx, 'SHADOW', 'insert partial close into engine_trades');
          await supabase.from('engine_trades').insert({
            engine_key: ctx.engineKey,
            engine_version: ctx.engineVersion,
            run_mode: ctx.runMode,
            ticker: pos.ticker,
            side: pos.side,
            entry_price: pos.entry_price,
            exit_price: currentPrice,
            opened_at: pos.opened_at,
            closed_at: now.toISOString(),
            realized_pnl: partialPnl,
            realized_r: partialPnlR,
            meta: {
              exit_reason: 'OVERNIGHT_PARTIAL_CLOSE',
              qty: partialQty,
              runner_qty: pos.qty * 0.5,
            },
          });
          
          console.log(
            `[shadow]   💰 Partial close: ${partialQty} shares @ $${currentPrice.toFixed(2)} | R=${partialPnlR.toFixed(2)}`
          );
        }
        
        if (slMove) {
          // Update position with new SL and reduced qty
          assertRunMode(ctx, 'SHADOW', 'update engine_positions with hygiene adjustments');
          await supabase
            .from('engine_positions')
            .update({
              stop_loss: slMove.newStopLoss,
              qty: pos.qty * 0.5,  // Reduce qty to 50% (runner)
              meta: {
                overnight_hygiene_applied: true,
                original_qty: pos.qty,
                original_sl: pos.stop_loss,
                partial_closed_at: now.toISOString(),
              },
            })
            .eq('id', pos.id);
          
          console.log(
            `[shadow]   🛡️  Risk removed: SL moved to BE ($${slMove.newStopLoss?.toFixed(2)})`
          );
        }
        
        if (atrTsl) {
          // Activate ATR-based trailing stop on runner
          console.log(
            `[shadow]   ↗️  ATR-based TSL activated: $${atrTsl.newTrailingStopPrice?.toFixed(2)} (ATR=${atrTsl.atrValue?.toFixed(2)})`
          );
        }
        
        // Skip full exit—let the runner portion continue
        return positionsToClose;
      }
      
      // Standard V2 time exit (if no overnight hygiene triggered)
      const isPreCloseWindow = nowUtc.getUTCHours() === 20 && nowUtc.getUTCMinutes() >= 45;
      if (
        isPreCloseWindow &&
        unrealizedPnlR != null &&
        unrealizedPnlR >= engineOverrides.time_exit_threshold_R &&
        timeInMinutes >= 120
      ) {
        exitReason = 'TIME_EXIT_PRE_CLOSE_V2';
        exitPrice = currentPrice;
        console.log(
          `[shadow]   🕒 TIME EXIT ${pos.ticker}: closing @ $${exitPrice.toFixed(2)} (R=${unrealizedPnlR.toFixed(2)})`
        );
      }
    }

    if (exitReason) {
      const exitDiff = isLong
        ? exitPrice - pos.entry_price
        : pos.entry_price - exitPrice;
      const realizedPnl = exitDiff * pos.qty;
      const realizedR = realizedPnl / riskDollars;

      console.log(
        `[shadow]   🚪 Closing ${pos.ticker} (${exitReason}): R=${realizedR.toFixed(2)}`
      );

      positionsToClose.push({
        pos,
        realizedPnl,
        notionalAtEntry: pos.notional_at_entry || (pos.qty * pos.entry_price),
        exitPrice,
        exitReason,
      });
    }
  }

  // Close positions
  for (const { pos, realizedPnl, exitPrice, exitReason } of positionsToClose) {
    const realizedR = realizedPnl / (pos.risk_dollars || 1);

    // Insert into engine_trades
    assertRunMode(ctx, 'SHADOW', 'insert closed trade into engine_trades');
    await supabase.from('engine_trades').insert({
      engine_key: ctx.engineKey,
      engine_version: ctx.engineVersion,
      run_mode: ctx.runMode,
      ticker: pos.ticker,
      side: pos.side,
      entry_price: pos.entry_price,
      exit_price: exitPrice,
      opened_at: pos.opened_at,
      closed_at: now.toISOString(),
      realized_pnl: realizedPnl,
      realized_r: realizedR,
      meta: {
        exit_reason: exitReason,
        qty: pos.qty,
      },
    });

    // Mark position as closed
    assertRunMode(ctx, 'SHADOW', 'update engine_positions status to CLOSED');
    await supabase
      .from('engine_positions')
      .update({
        status: 'CLOSED',
        closed_at: now.toISOString(),
        exit_price: exitPrice,
        exit_reason: exitReason,
        realized_pnl: realizedPnl,
        realized_r: realizedR,
      })
      .eq('id', pos.id);
  }

  // Recalculate state
  const newCash = state.cash_dollars + positionsToClose.reduce(
    (sum, c) => sum + c.notionalAtEntry + c.realizedPnl,
    0,
  );

  // Refetch remaining open shadow positions
  const { data: remainingOpenPositions, error: remainingPosError } = await supabase
    .from('engine_positions')
    .select('notional_at_entry, qty, entry_price')
    .eq('engine_key', ctx.engineKey)
    .eq('engine_version', ctx.engineVersion)
    .eq('run_mode', ctx.runMode)
    .eq('status', 'OPEN');

  if (remainingPosError) {
    console.error('[shadow] Error refetching remaining open positions:', remainingPosError);
    // Fallback
    const remainingPositions = positions.length - positionsToClose.length;
    const newEquityFallback = newCash + totalAllocatedNotional + totalUnrealizedPnl;

    return {
      strategy: state.strategy,
      equity_dollars: newEquityFallback,
      cash_dollars: newCash,
      open_positions_count: remainingPositions,
      allocated_notional: totalAllocatedNotional,
      unrealized_pnl_dollars: totalUnrealizedPnl,
    };
  }

  const allocatedNotional = (remainingOpenPositions || []).reduce(
    (sum: number, p: any) => sum + (p.notional_at_entry || (p.qty * p.entry_price)),
    0,
  );

  // For shadow, unrealized PnL calculation requires current prices - approximate as 0 for now
  const unrealizedPnl = 0;

  const remainingCount = (remainingOpenPositions || []).length;
  const newEquity = newCash + allocatedNotional + unrealizedPnl;

  return {
    strategy: state.strategy,
    equity_dollars: newEquity,
    cash_dollars: newCash,
    open_positions_count: remainingCount,
    allocated_notional: allocatedNotional,
    unrealized_pnl_dollars: unrealizedPnl,
  };
}

async function logSignalDecision(
  ctx: EngineContext,
  supabase: any,
  params: {
    signal: Signal;
    config: any;
    state: PortfolioState;
    decision: string;
    reasonCode?: string;
    context?: Record<string, unknown>;
    entryPriceAtDecision?: number | null;
    riskRewardRatio?: number | null;
    tradeGateAllowed?: boolean;
    tradeGateReason?: string;
    tradeGateTimeET?: string;
    engineKey?: string;
    engineVersion?: string;
    publishableSignal?: boolean;
    publishConfidence?: number | null;
  },
) {
  const { signal, config, state, decision } = params;
  const reasonCode = params.reasonCode ?? decision;
  const engineKey = params.engineKey ?? ctx.engineKey;
  const engineVersion = params.engineVersion ?? ctx.engineVersion;
  const publishableSignal = params.publishableSignal ?? true;
  const publishConfidence = params.publishConfidence ?? signal.confidence_score ?? null;

  try {
    await supabase.from('live_signal_decision_log').insert({
      signal_id: signal.id,
      strategy: config.strategy,
      engine_type: signal.engine_type,
      ticker: signal.symbol,
      decision,
      reason_code: reasonCode,
      reason_context: params.context ?? null,
      confidence_score: signal.confidence_score ?? null,
      entry_price_signal: signal.entry_price ?? null,
      entry_price_at_decision: params.entryPriceAtDecision ?? null,
      stop_loss: signal.stop_loss ?? null,
      take_profit_1: signal.take_profit_1 ?? null,
      risk_reward_ratio: params.riskRewardRatio ?? null,
      portfolio_open_positions: state.open_positions_count,
      portfolio_allocated_notional: state.allocated_notional,
      portfolio_equity: state.equity_dollars,
      engine_key: engineKey,
      engine_version: engineVersion,
      run_mode: ctx.runMode,
      trade_gate_allowed: params.tradeGateAllowed ?? null,
      trade_gate_reason: params.tradeGateReason ?? null,
      trade_gate_et_time: params.tradeGateTimeET ?? null,
      publishable_signal: publishableSignal,
      publish_confidence: publishConfidence,
    });
  } catch (e) {
    console.warn('[model_portfolio_manager] Failed to log live signal decision:', e?.message ?? e);
  }
}

type PortfolioLane = 'CORE' | 'EXPLORE';

type PortfolioBucketState = {
  guard: PortfolioBucketGuard;
  coreOpen: number;
  exploreOpen: number;
};

async function processNewSignals(
  ctx: EngineContext,
  supabase: any,
  config: any,
  signals: Signal[],
  state: PortfolioState,
  tradeGate?: TradeGateStatus,
  allocationCtx?: AllocationContext | null,
  portfolioGuard?: PortfolioBucketGuard | null,
) {
  console.log(`  Processing ${signals.length} signals...`);
  const gateMeta = {
    tradeGateAllowed: tradeGate?.allowed ?? null,
    tradeGateReason: tradeGate?.reason ?? null,
    tradeGateTimeET: tradeGate?.currentTimeET ?? null,
  };
  const allocation = allocationCtx || null;

  // Load existing positions to check for duplicates
  const { data: existingPositions } = await supabase
    .from("live_positions")
    .select("ticker")
    .eq("strategy", config.strategy);

  const existingTickers = new Set(
    (existingPositions || []).map((p: any) => p.ticker)
  );

  const bucketState: PortfolioBucketState | null = portfolioGuard
    ? {
        guard: portfolioGuard,
        coreOpen: 0,
        exploreOpen: 0,
      }
    : null;

  if (bucketState && existingPositions) {
    for (const pos of existingPositions) {
      const normalized = normalizePortfolioSymbol(pos.ticker);
      if (!normalized) continue;
      if (bucketState.guard.coreSymbols.has(normalized)) {
        bucketState.coreOpen += 1;
      } else if (bucketState.guard.exploreSymbols.has(normalized)) {
        bucketState.exploreOpen += 1;
      }
    }
    console.log(
      `[portfolio_guard] open core=${bucketState.coreOpen}/${bucketState.guard.coreSlots} explore=${bucketState.exploreOpen}/${bucketState.guard.exploreSlots}`,
    );
  }

  for (const signal of signals) {
    const ticker = signal.symbol;  // Use 'symbol' from ai_signals

    console.log(
      `  ▶ Evaluating ${ticker} | style=${signal.trading_style} engine=${signal.engine_type} conf=${signal.confidence_score} entry=${signal.entry_price} SL=${signal.stop_loss} TP1=${signal.take_profit_1}`
    );
    console.log(
      `    State before sizing → equity=${state.equity_dollars.toFixed(2)} cash=${state.cash_dollars.toFixed(2)} allocated=${state.allocated_notional.toFixed(2)} open=${state.open_positions_count}`
    );

    const routing = resolveEngineRouting(
      allocation,
      ticker,
      ctx.engineKey,
      config.engine_version,
    );
    const desiredVersion = routing.engine_version;
    const signalVersion = signal.engine_version || config.engine_version;

    if (routing.enforced && !matchesOwnedEngineVersion(signalVersion, desiredVersion)) {
      console.log(
        `  ⏭️  Skipping ${ticker} - owner expects ${desiredVersion} but signal is ${signalVersion}`,
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_WRONG_ENGINE_OWNER',
        context: {
          owner_engine_version: desiredVersion,
          signal_engine_version: signalVersion,
        },
        engineKey: routing.engine_key,
        engineVersion: desiredVersion,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    const engineKeyForTrade = routing.engine_key;
    const engineVersionForTrade = routing.enforced ? desiredVersion : signalVersion;

    let assignedLane: PortfolioLane | null = null;
    if (bucketState) {
      assignedLane = classifyPortfolioLane(bucketState.guard, ticker);
      if (!assignedLane) {
        await logSignalDecision(ctx, supabase, {
          signal,
          config,
          state,
          decision: 'SKIP_OUTSIDE_PORTFOLIO_BUCKET',
          context: buildLaneContext(null, bucketState),
          engineKey: engineKeyForTrade,
          engineVersion: engineVersionForTrade,
          publishConfidence: signal.confidence_score ?? null,
        });
        continue;
      }

      if (assignedLane === 'CORE' && bucketState.coreOpen >= bucketState.guard.coreSlots) {
        await logSignalDecision(ctx, supabase, {
          signal,
          config,
          state,
          decision: 'SKIP_CORE_SLOTS_FULL',
          context: buildLaneContext(assignedLane, bucketState),
          engineKey: engineKeyForTrade,
          engineVersion: engineVersionForTrade,
          publishConfidence: signal.confidence_score ?? null,
        });
        continue;
      }

      if (assignedLane === 'EXPLORE') {
        if (bucketState.guard.exploreSlots === 0) {
          await logSignalDecision(ctx, supabase, {
            signal,
            config,
            state,
            decision: 'SKIP_EXPLORE_DISABLED',
            context: buildLaneContext(assignedLane, bucketState),
            engineKey: engineKeyForTrade,
            engineVersion: engineVersionForTrade,
            publishConfidence: signal.confidence_score ?? null,
          });
          continue;
        }
        if (bucketState.exploreOpen >= bucketState.guard.exploreSlots) {
          await logSignalDecision(ctx, supabase, {
            signal,
            config,
            state,
            decision: 'SKIP_EXPLORE_SLOTS_FULL',
            context: buildLaneContext(assignedLane, bucketState),
            engineKey: engineKeyForTrade,
            engineVersion: engineVersionForTrade,
            publishConfidence: signal.confidence_score ?? null,
          });
          continue;
        }
      }
    }
    
    // Skip if already have position in this ticker
    if (existingTickers.has(ticker)) {
      console.log(`  ⏭️  Skipping ${ticker} - position already open`);
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_EXISTING_POSITION',
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        context: bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    // Skip if max concurrent positions reached
    if (state.open_positions_count >= config.max_concurrent_positions) {
      console.log(
        `  ⏭️  Skipping ${ticker} - max concurrent positions reached`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_MAX_POSITIONS',
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        context: bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    // Validate risk/reward ratio (minimum 0.5R)
    const riskPerShare = Math.abs(signal.entry_price - signal.stop_loss);
    const rewardPerShare = Math.abs(signal.take_profit_1 - signal.entry_price);
    const riskRewardRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

    // Validate reasonable distances using ATR-based guardrails
    const distanceValidation = await validateSignalDistanceWithATR(ticker, signal, riskRewardRatio);
    if (distanceValidation) {
      const contextReason = (distanceValidation.context as any).reason || 'unrealistic distance';
      console.log(
        `  ⏭️  Skipping ${ticker} - ${contextReason}. Details: ${JSON.stringify(distanceValidation.context)}`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: distanceValidation.decision,
        riskRewardRatio,
        context: mergeContexts(
          distanceValidation.context,
          bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        ),
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    if (riskRewardRatio < 0.5) {
      console.log(
        `  ⏭️  Skipping ${ticker} - R:R too low (${riskRewardRatio.toFixed(2)}R, minimum 0.5R required). Risk=$${riskPerShare.toFixed(2)}, Reward=$${rewardPerShare.toFixed(2)}`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_RR_TOO_LOW',
        riskRewardRatio,
        context: mergeContexts(
          {
            risk_per_share: riskPerShare,
            reward_per_share: rewardPerShare,
          },
          bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        ),
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    // Calculate position size
    const positionSize = calculatePositionSize(config, signal, state);

    if (positionSize === null) {
      console.log(
        `  ⏭️  Skipping ${ticker} - insufficient capacity or below min threshold`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_CAPACITY',
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        context: bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    // Fetch current price for entry
    const currentQuote = await fetchBulkQuotes([ticker]);
    const currentPrice = currentQuote[ticker]?.price;
    
    if (!currentPrice) {
      console.warn(`  ⚠️  ${ticker}: Failed to get real-time price, skipping`);
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_PRICE_FETCH_ERROR',
        context: mergeContexts(
          { reason: 'no_current_price' },
          bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        ),
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    // Validate signal freshness: reject if price has moved >1.5% from signal entry
    const priceDeviation = Math.abs(currentPrice - signal.entry_price) / signal.entry_price;
    if (priceDeviation > 0.015) {
      // Before skipping, check if 1m bars touched entry level recently (smarter entry timing)
      console.log(
        `  ⚠️  ${ticker} - price deviated ${(priceDeviation * 100).toFixed(2)}% from signal, checking 1m bars...`
      );
      
      try {
        const barsData = await fetchPositionBars(ticker);
        let touchedEntry = false;
        
        if (barsData?.bars && barsData.bars.length > 0) {
          // Check last 5 bars to see if entry price was touched
          const last5Bars = barsData.bars.slice(-5);
          
          for (const bar of last5Bars) {
            const low = Math.min(bar.low, bar.open, bar.close);
            const high = Math.max(bar.high, bar.open, bar.close);
            const entryWithinBar = signal.entry_price >= low && signal.entry_price <= high;
            
            if (entryWithinBar) {
              touchedEntry = true;
              console.log(
                `  ✓ Entry price $${signal.entry_price.toFixed(2)} was touched in recent ${barsData.interval} bar (${bar.timestamp})`
              );
              break;
            }
          }
        }
        
        if (!touchedEntry) {
          console.log(
            `  ⏭️  Skipping ${ticker} - signal stale (entry=${signal.entry_price}, current=${currentPrice.toFixed(2)}, not touched in recent bars)`
          );
          await logSignalDecision(ctx, supabase, {
            signal,
            config,
            state,
            decision: 'SKIP_STALE_ENTRY',
            entryPriceAtDecision: currentPrice,
            context: mergeContexts(
              {
                deviation_pct: (priceDeviation * 100),
                touched_entry_recently: false,
              },
              bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
            ),
            ...gateMeta,
            engineKey: engineKeyForTrade,
            engineVersion: engineVersionForTrade,
            publishConfidence: signal.confidence_score ?? null,
          });
          continue;
        }
        
        // Price touched entry recently, proceed with entry at current price
        console.log(`  ✓ Proceeding with entry at current price $${currentPrice.toFixed(2)}`);
      } catch (error) {
        console.warn(`  ⚠️  ${ticker} - failed to fetch bars for entry check:`, error.message);
        console.log(
          `  ⏭️  Skipping ${ticker} - signal stale (entry=${signal.entry_price}, current=${currentPrice.toFixed(2)}, deviation=${(priceDeviation * 100).toFixed(2)}%, max 1.5%)`
        );
        await logSignalDecision(ctx, supabase, {
          signal,
          config,
          state,
          decision: 'SKIP_STALE_ENTRY',
          entryPriceAtDecision: currentPrice,
          context: mergeContexts({
            deviation_pct: (priceDeviation * 100),
            error: (error as any)?.message ?? String(error),
          }, bucketState ? buildLaneContext(assignedLane, bucketState) : undefined),
          ...gateMeta,
          engineKey: engineKeyForTrade,
          engineVersion: engineVersionForTrade,
          publishConfidence: signal.confidence_score ?? null,
        });
        continue;
      }
    }

    const entryPrice = currentPrice;
    
    // Determine side (LONG/SHORT) from signal decision
    const decision = (signal.ai_decision || signal.signal_type || 'buy').toLowerCase();
    const side = decision === 'sell' ? 'SHORT' : 'LONG';

    // Sanity check: SL must be on the correct side of entry (loss direction)
    if (side === 'LONG' && signal.stop_loss >= entryPrice) {
      console.log(
        `  ⏭️  Skipping ${ticker} - LONG SL (${signal.stop_loss}) is not below entry (${entryPrice.toFixed(2)})`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_SL',
        entryPriceAtDecision: entryPrice,
        context: mergeContexts(
          { side, stop_loss: signal.stop_loss },
          bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
        ),
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }
    if (side === 'SHORT' && signal.stop_loss <= entryPrice) {
      console.log(
        `  ⏭️  Skipping ${ticker} - SHORT SL (${signal.stop_loss}) is not above entry (${entryPrice.toFixed(2)})`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_SL',
        entryPriceAtDecision: entryPrice,
        context: { side, stop_loss: signal.stop_loss },
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }

    // Sanity check: TP must be on the correct side of entry (profit direction)
    if (side === 'LONG' && signal.take_profit_1 <= entryPrice) {
      console.log(
        `  ⏭️  Skipping ${ticker} - LONG TP (${signal.take_profit_1}) is not above entry (${entryPrice.toFixed(2)})`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_TP',
        entryPriceAtDecision: entryPrice,
        context: { side, tp1: signal.take_profit_1 },
        engineKey: engineKeyForTrade,
        engineVersion: engineVersionForTrade,
        publishConfidence: signal.confidence_score ?? null,
      });
      continue;
    }
    if (side === 'SHORT' && signal.take_profit_1 >= entryPrice) {
      console.log(
        `  ⏭️  Skipping ${ticker} - SHORT TP (${signal.take_profit_1}) is not below entry (${entryPrice.toFixed(2)})`
      );
      await logSignalDecision(ctx, supabase, {
        signal,
        config,
        state,
        decision: 'SKIP_INVALID_TP',
        entryPriceAtDecision: entryPrice,
        context: { side, tp1: signal.take_profit_1 },
      });
      continue;
    }
    
    // Calculate TP1 and TP2 if runner feature is enabled
    const tpRiskPerShare = Math.abs(entryPrice - signal.stop_loss);
    const tp1Price = signal.take_profit_1;  // TP1 comes from signal (default 1.5R)
    let tp2Price: number | null = null;
    
    if (config.enableTp2) {
      // Calculate TP2 based on R-multiple
      tp2Price = side === 'LONG'
        ? entryPrice + (tpRiskPerShare * config.tp2RMultiple)
        : entryPrice - (tpRiskPerShare * config.tp2RMultiple);
      
      console.log(
        `  🎯 TP2 enabled: TP1=$${tp1Price.toFixed(2)} (1.5R), TP2=$${tp2Price.toFixed(2)} (${config.tp2RMultiple}R)`
      );
    }
    
    // Open position
    console.log(
      `  ✅ Opening ${ticker} (${side}) - ${positionSize.size_shares} shares @ $${entryPrice.toFixed(2)}`
    );
    await logSignalDecision(ctx, supabase, {
      signal,
      config,
      state,
      decision: 'OPEN',
      entryPriceAtDecision: entryPrice,
      riskRewardRatio,
      context: bucketState ? buildLaneContext(assignedLane, bucketState) : undefined,
      engineKey: engineKeyForTrade,
      engineVersion: engineVersionForTrade,
      publishConfidence: signal.confidence_score ?? null,
    });
    
    assertRunMode(ctx, 'PRIMARY', 'insert new position into live_positions');
    const { data: insertData, error: insertError } = await supabase.from("live_positions").insert({
      strategy: config.strategy,
      ticker: ticker,
      signal_id: signal.id,
      engine_key: engineKeyForTrade,
      engine_version: engineVersionForTrade,
      side,
      entry_timestamp: new Date().toISOString(),
      entry_price: entryPrice,
      size_shares: positionSize.size_shares,
      notional_at_entry: positionSize.notional,
      stop_loss: signal.stop_loss,
      take_profit: tp1Price,  // Use TP1
      risk_dollars: positionSize.risk_dollars,
      risk_r: 1.0,
      current_price: entryPrice,
      unrealized_pnl_dollars: 0,
      unrealized_pnl_r: 0,
      // Initialize trailing stop fields
      trailing_stop_active: false,
      highest_price_reached: side === 'LONG' ? entryPrice : null,
      lowest_price_reached: side === 'SHORT' ? entryPrice : null,
      trailing_stop_price: null,
      // TP2 runner fields
      tp1_price: config.enableTp2 ? tp1Price : null,
      tp2_price: config.enableTp2 ? tp2Price : null,
      tp1_hit: false,
      runner_active: false,
    });

    if (insertError) {
      console.error(`  ❌ Failed to insert ${ticker}:`, insertError);
      continue; // Skip state update if INSERT failed
    }
    if (bucketState) {
      if (assignedLane === 'CORE') {
        bucketState.coreOpen += 1;
      } else if (assignedLane === 'EXPLORE') {
        bucketState.exploreOpen += 1;
      }
    }

    // Update state ONLY if INSERT succeeded
    state.cash_dollars -= positionSize.notional;
    state.allocated_notional += positionSize.notional;
    state.open_positions_count += 1;
    existingTickers.add(ticker);
  }
}

function calculatePositionSize(
  config: any,
  signal: Signal,
  state: PortfolioState
): { size_shares: number; notional: number; risk_dollars: number } | null {
  // Calculate risk-based position size using current equity (allows compounding)
  const riskPerTrade = state.equity_dollars * config.risk_per_trade_pct;
  const riskPerShare = Math.abs(signal.entry_price - signal.stop_loss);

  if (riskPerShare === 0) {
    console.log(`  ⚠️  ${signal.symbol} - Invalid risk (SL = entry)`);
    return null;
  }

  let sizeShares = Math.floor(riskPerTrade / riskPerShare);
  let notional = sizeShares * signal.entry_price;

  // Apply max notional per position cap
  const maxNotional = state.equity_dollars * config.max_notional_per_position_pct;
  if (notional > maxNotional) {
    sizeShares = Math.floor(maxNotional / signal.entry_price);
    notional = sizeShares * signal.entry_price;
  }

  // Apply portfolio capacity cap (80% max allocation)
  const maxAllocation = state.equity_dollars * config.max_portfolio_allocation_pct;
  const remainingCapacity = maxAllocation - state.allocated_notional;

  if (remainingCapacity <= 0) {
    console.log(
      `  ⚠️  ${signal.symbol} - No remaining capacity (allocated=${state.allocated_notional.toFixed(2)} max=${maxAllocation.toFixed(2)})`
    );
    return null;
  }

  if (notional > remainingCapacity) {
    // Scale down to fit
    const scaledShares = Math.floor(remainingCapacity / signal.entry_price);
    console.log(
      `  ℹ️  ${signal.symbol} - Scaling position to fit capacity: requestedNotional=${notional.toFixed(2)} remainingCap=${remainingCapacity.toFixed(2)} scaledShares=${scaledShares}`
    );
    sizeShares = scaledShares;
    notional = sizeShares * signal.entry_price;
  }

  // Check minimum threshold
  if (notional < config.min_position_notional || sizeShares < 1) {
    console.log(
      `  ⚠️  ${signal.symbol} - Position below minimum after constraints: size=${sizeShares}, notional=${notional.toFixed(2)}, minNotional=${config.min_position_notional}`
    );
    return null;
  }

  const actualRiskDollars = sizeShares * riskPerShare;

  console.log(
    `  ✅ Position sizing for ${signal.symbol}: shares=${sizeShares}, notional=${notional.toFixed(2)}, risk=$${actualRiskDollars.toFixed(2)}, remainingCap=${remainingCapacity.toFixed(2)}`
  );

  return {
    size_shares: sizeShares,
    notional: notional,
    risk_dollars: actualRiskDollars,
  };
}

async function savePortfolioState(
  ctx: EngineContext,
  supabase: any,
  strategy: string,
  state: PortfolioState
) {
  assertRunMode(ctx, 'PRIMARY', 'insert portfolio snapshot into live_portfolio_state');
  await supabase.from("live_portfolio_state").insert({
    strategy: strategy,
    timestamp: new Date().toISOString(),
    equity_dollars: state.equity_dollars,
    cash_dollars: state.cash_dollars,
    open_positions_count: state.open_positions_count,
    allocated_notional: state.allocated_notional,
    unrealized_pnl_dollars: state.unrealized_pnl_dollars,
  });

  console.log(
    `  💾 Saved state - Equity: $${state.equity_dollars.toFixed(2)}, Cash: $${state.cash_dollars.toFixed(2)}, Positions: ${state.open_positions_count}`
  );
}

function summarizeSymbols(set: Set<string>, limit = 12): string {
  const symbols = Array.from(set);
  if (symbols.length === 0) return '∅';
  if (symbols.length <= limit) {
    return symbols.join(', ');
  }
  const overflow = symbols.length - limit;
  return `${symbols.slice(0, limit).join(', ')} … (+${overflow} more)`;
}

function normalizePortfolioSymbol(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}

function classifyPortfolioLane(
  guard: PortfolioBucketGuard,
  symbol: string,
): PortfolioLane | null {
  const normalized = normalizePortfolioSymbol(symbol);
  if (!normalized) return null;
  if (guard.coreSymbols.has(normalized)) return 'CORE';
  if (guard.exploreSymbols.has(normalized)) return 'EXPLORE';
  return null;
}

function buildLaneContext(
  lane: PortfolioLane | null,
  bucketState: PortfolioBucketState | null,
): Record<string, unknown> {
  if (!bucketState) return { portfolio_lane: lane ?? 'DISABLED' };
  return {
    portfolio_lane: lane ?? 'UNASSIGNED',
    portfolio_core_slots: bucketState.guard.coreSlots,
    portfolio_core_open: bucketState.coreOpen,
    portfolio_explore_slots: bucketState.guard.exploreSlots,
    portfolio_explore_open: bucketState.exploreOpen,
    portfolio_snapshot_date: bucketState.guard.snapshotDate,
  };
}

function mergeContexts(
  base?: Record<string, unknown>,
  lane?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!base && !lane) return undefined;
  return {
    ...(lane ?? {}),
    ...(base ?? {}),
  };
}
