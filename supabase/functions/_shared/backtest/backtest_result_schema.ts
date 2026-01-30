// supabase/functions/_shared/backtest/backtest_result_schema.ts
//
// Shared, engine-agnostic schema for backtest outputs written to
// `backtests/{engine_version}/{symbol}/{horizon}.json`.
//
// All engines (v4.6 baseline, v4.7-alpha experiments, v5, ...) should
// normalize their results into this shape so that downstream tools
// (research harness, dashboards, analytics) can compare them easily.

import type { OHLCBar } from "../signal_types.ts";

// Logical backtest horizons used across all engines.
export type BacktestHorizon = "day" | "swing" | "invest";

// Normalized equity curve point.
export interface BacktestEquityPoint {
  // ISO date/time (UTC). For daily / higher TF this will usually be the
  // session close; for intraday it is the bar timestamp.
  date: string;
  // Portfolio equity in dollars.
  equity: number;
}

// Normalized trade record.
export interface BacktestTradeRecord {
  entry_time: string;   // ISO timestamp
  exit_time: string;    // ISO timestamp
  direction: "long" | "short";
  size: number | null;  // number of shares/contracts when available, else null
  entry_price: number;
  exit_price: number;
  // Percentage return per trade (e.g. +4.5 for +4.5%). Optional when the
  // engine cannot infer it precisely.
  pnl_pct: number | null;
  // Absolute P/L in dollars.
  pnl_abs: number;
}

// Aggregate performance metrics for a single (engine,symbol,horizon) run.
//
// All percentage metrics are expressed as 0–100 (e.g. 12.5 = +12.5%).
export interface BacktestMetrics {
  // Core trade stats
  trades: number;
  win_rate: number;          // % of winning trades
  avg_r: number | null;      // average R-multiple
  best_trade_r: number | null;
  worst_trade_r: number | null;

  // Portfolio level performance
  total_return: number;      // % equity change over the full period
  cagr: number;              // compound annual growth rate in %
  max_drawdown: number;      // worst peak-to-trough drawdown in %

  // Risk / reward quality metrics (optional for some engines)
  sharpe: number | null;
  sortino: number | null;
  profit_factor: number | null;      // gross profit / gross loss

  // Per-trade / frequency metrics
  avg_trade_return: number | null;   // average per-trade % return
  median_trade_return: number | null;
  trades_per_year: number | null;
}

// Top-level normalized backtest result.
export interface BacktestResult {
  // Human-readable engine label, e.g. "v4.6", "v4.7-alpha".
  engine_version: string;

  // Symbol metadata
  symbol: string;             // e.g. "AAPL"
  horizon: BacktestHorizon;   // day | swing | invest
  timeframe_used: string;     // actual TF used (e.g. "1m", "4h", "1d")

  // Temporal coverage
  start_date: string;         // ISO date/time of first bar
  end_date: string;           // ISO date/time of last bar

  // Data sanity
  bars_loaded: number;        // number of OHLC bars used

  // Summary metrics and detailed series
  metrics: BacktestMetrics;
  equity_curve: BacktestEquityPoint[];
  trades: BacktestTradeRecord[];

  // Engine-specific warnings (e.g. insufficient data, loader anomalies)
  anomalies: string[];

  // Optional raw engine payload for debugging / future migration.
  raw_engine_payload?: unknown;
}

// Helper type used by some callers when they want to run the engine on
// pre-loaded bars without caring about the internal representation.
export interface EngineInput {
  symbol: string;
  timeframe: string;
  horizon: BacktestHorizon;
  bars: OHLCBar[];
}
