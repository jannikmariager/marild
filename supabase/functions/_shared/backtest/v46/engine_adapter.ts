// supabase/functions/_shared/backtest/v46/engine_adapter.ts
//
// Adapter that wraps the existing Backtest Engine V4 core implementation
// and exposes it through the generic EngineRunner interface while
// normalizing results into the shared BacktestResult schema.

import type { OHLCBar } from "../../signal_types.ts";
import type { BacktestResultV4 } from "../v4/backtest_engine_v4.ts";
import { runBacktestV4 as runBacktestCore } from "../v4/backtest_engine_v4.ts";
import type {
  BacktestResult,
  BacktestHorizon,
  BacktestMetrics,
  BacktestEquityPoint,
  BacktestTradeRecord,
} from "../backtest_result_schema.ts";
import type { EngineConfig, EngineRunner } from "../engine_interface.ts";

const DEFAULT_STARTING_EQUITY = 100_000;

function computeDateRange(equityCurve: Array<{ t: number; balance: number }>): {
  start: string;
  end: string;
} {
  if (!equityCurve.length) {
    const now = new Date().toISOString();
    return { start: now, end: now };
  }
  const first = equityCurve[0].t;
  const last = equityCurve[equityCurve.length - 1].t;
  return {
    start: new Date(first).toISOString(),
    end: new Date(last).toISOString(),
  };
}

function buildMetrics(
  stats: BacktestResultV4["stats"],
  equityCurve: Array<{ t: number; balance: number }>,
  horizon: BacktestHorizon,
): BacktestMetrics {
  const trades = stats.trades_total ?? 0;
  const win_rate = stats.win_rate ?? 0;
  const avg_r = stats.avg_r ?? null;
  const best_trade_r = stats.best_trade_r ?? null;
  const worst_trade_r = stats.worst_trade_r ?? null;

  const startingEquity = equityCurve[0]?.balance ?? DEFAULT_STARTING_EQUITY;
  const endingEquity = equityCurve[equityCurve.length - 1]?.balance ?? startingEquity;
  const total_return = startingEquity > 0
    ? ((endingEquity - startingEquity) / startingEquity) * 100
    : 0;

  // Approximate horizon in years based on first/last equity timestamps.
  let years = 0;
  if (equityCurve.length >= 2) {
    const firstTs = equityCurve[0].t;
    const lastTs = equityCurve[equityCurve.length - 1].t;
    const ms = Math.max(lastTs - firstTs, 0);
    years = ms / (365 * 24 * 60 * 60 * 1000);
  }

  // Fallback horizon-based approximation if timestamps are degenerate.
  if (!Number.isFinite(years) || years <= 0) {
    const horizonDaysMap: Record<BacktestHorizon, number> = {
      day: 90,
      swing: 730,
      invest: 1825,
    };
    years = (horizonDaysMap[horizon] ?? 365) / 365;
  }

  const cagr = years > 0 && startingEquity > 0 && endingEquity > 0
    ? (Math.pow(endingEquity / startingEquity, 1 / years) - 1) * 100
    : total_return;

  const max_drawdown = stats.max_drawdown ?? 0;

  // Profit factor (sum of positive pnl / abs(sum of negative pnl)).
  // This is computed in the harness using the trades list rather than here,
  // but the field is part of the schema. For now we leave it null and let
  // callers compute it when they have full trade context.
  const profit_factor: number | null = null;

  return {
    trades,
    win_rate,
    avg_r,
    best_trade_r,
    worst_trade_r,
    total_return,
    cagr,
    max_drawdown,
    sharpe: null,
    sortino: null,
    profit_factor,
    avg_trade_return: null,
    median_trade_return: null,
    trades_per_year: trades > 0 && years > 0 ? trades / years : null,
  };
}

function normalizeEquityCurve(
  equityCurve: Array<{ t: number; balance: number }>,
): BacktestEquityPoint[] {
  return equityCurve.map((p) => ({
    date: new Date(p.t).toISOString(),
    equity: p.balance,
  }));
}

function normalizeTrades(
  trades: BacktestResultV4["trades"],
  startingEquity: number,
): BacktestTradeRecord[] {
  return trades.map((t) => {
    const pnl_abs = t.pnl ?? 0;
    const pnl_pct = startingEquity > 0 ? (pnl_abs / startingEquity) * 100 : null;

    return {
      entry_time: t.entryTime,
      exit_time: t.exitTime,
      direction: t.direction,
      size: null, // size is not part of TradeV4; keep null for now
      entry_price: t.entryPrice,
      exit_price: t.exitPrice,
      pnl_pct,
      pnl_abs,
    };
  });
}

export const v46EngineRunner: EngineRunner = {
  async runBacktest(
    cfg: EngineConfig,
    symbol: string,
    bars: OHLCBar[],
  ): Promise<BacktestResult> {
    const startingEquity = cfg.startingEquity ?? DEFAULT_STARTING_EQUITY;

    const raw: BacktestResultV4 = await runBacktestCore({
      engine_type: cfg.engineType,
      engine_version: "V4_1",
      symbol,
      timeframe: cfg.timeframe,
      starting_equity: startingEquity,
    }, bars);

    const { start, end } = computeDateRange(raw.stats.equity_curve);
    const metrics = buildMetrics(raw.stats, raw.stats.equity_curve, cfg.horizon);
    const equity_curve = normalizeEquityCurve(raw.stats.equity_curve);
    const trades = normalizeTrades(raw.trades, startingEquity);

    const result: BacktestResult = {
      engine_version: cfg.engineVersion,
      symbol,
      horizon: cfg.horizon,
      timeframe_used: raw.timeframe_used,
      start_date: start,
      end_date: end,
      bars_loaded: raw.bars_loaded,
      metrics,
      equity_curve,
      trades,
      anomalies: raw.anomalies ?? [],
      raw_engine_payload: raw,
    };

    return result;
  },
};

export default v46EngineRunner;
