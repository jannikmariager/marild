// supabase/functions/_shared/backtest/daytrader_v50_wrapped.ts
//
// Wrapper around the v5.0 backtest engine that:
// - For DAYTRADER: applies a ticker WHITELIST/BLACKLIST and max trades limit.
// - For SWING/INVESTOR: routes to v4.9 unchanged.
//
// This is used as a high-level engine version "v5.0_wrapped" in the
// v4_router so we can treat it as a separate engine in backtests.

import type { OHLCBar } from "../signal_types.ts";
import { runBacktestV4 as runV49, type BacktestConfigV4, type BacktestResultV4 } from "./v4_9/backtest_engine_v4.ts";
import { runBacktestV5, type BacktestResultV5, type BacktestStatsV5 } from "./v5_0/backtest_engine_v5.ts";
import { getDaytraderConfig, DAYTRADER_LIMITS_V50 } from "./daytrader_universe_v50.ts";

// Local copy of the TradeV5 type for clarity
import type { TradeV5 } from "./v5_0/execution_model_v50.ts";

function computeLimitedStats(
  trades: TradeV5[],
  startingEquity: number,
): BacktestStatsV5 {
  const trades_total = trades.length;
  if (trades_total === 0) {
    return {
      trades_total: 0,
      win_rate: 0,
      avg_r: 0,
      max_drawdown: 0,
      best_trade_r: null,
      worst_trade_r: null,
    };
  }

  const wins = trades.filter((t) => t.rMultiple > 0).length;
  const win_rate = (wins / trades_total) * 100;
  const rValues = trades.map((t) => t.rMultiple);
  const avg_r = rValues.reduce((s, r) => s + r, 0) / trades_total;
  const best_trade_r = Math.max(...rValues);
  const worst_trade_r = Math.min(...rValues);

  // Rebuild a simple equity curve from trades only (no intrabar detail)
  let equity = startingEquity;
  let peak = startingEquity;
  let max_drawdown = 0;
  const equityCurve: Array<{ t: number; balance: number }> = [
    { t: 0, balance: startingEquity },
  ];

  trades.forEach((t, idx) => {
    equity += t.pnl;
    equityCurve.push({ t: idx + 1, balance: equity });
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > max_drawdown) max_drawdown = dd;
  });

  return {
    trades_total,
    win_rate,
    avg_r,
    max_drawdown,
    best_trade_r,
    worst_trade_r,
  } as BacktestStatsV5 & { equity_curve: Array<{ t: number; balance: number }> };
}

export async function runBacktestV50Wrapped(
  config: BacktestConfigV4,
  bars: OHLCBar[],
): Promise<BacktestResultV4> {
  const startingEquity = config.starting_equity ?? 100_000;

  // SWING and INVESTOR: keep routing to v4.9 unchanged
  if (config.engine_type !== 'DAYTRADER') {
    return await runV49(config, bars);
  }

  const cfg = getDaytraderConfig(config.symbol);
  const maxTrades = DAYTRADER_LIMITS_V50.maxTradesPerBacktest;

  // Explicitly disabled / blacklisted tickers: no trades
  if (cfg && cfg.status === 'DISABLED') {
    return {
      symbol: config.symbol,
      timeframe_used: config.timeframe,
      bars_loaded: bars.length,
      trades: [],
      stats: {
        trades_total: 0,
        win_rate: 0,
        avg_r: 0,
        max_drawdown: 0,
        best_trade_r: null,
        worst_trade_r: null,
        equity_curve: [],
        filtered_signals: 0,
        total_signals: 0,
        filter_reasons: {
          daytrader_blacklisted_or_disabled_v50: 1,
        },
      },
      anomalies: ['daytrader_blacklisted_or_disabled_v50'],
    };
  }

  // Otherwise, run the raw v5.0 backtest
  const base: BacktestResultV5 = await runBacktestV5(
    {
      engine_type: config.engine_type,
      engine_version: config.engine_version,
      symbol: config.symbol,
      timeframe: config.timeframe,
      starting_equity: startingEquity,
    },
    bars,
  );

  let trades = base.trades as TradeV5[];
  if (trades.length > maxTrades) {
    trades = trades.slice(0, maxTrades);
  }

  const statsCore = computeLimitedStats(trades, startingEquity);

  const stats: BacktestResultV4['stats'] = {
    trades_total: statsCore.trades_total,
    win_rate: statsCore.win_rate,
    avg_r: statsCore.avg_r,
    max_drawdown: statsCore.max_drawdown,
    best_trade_r: statsCore.best_trade_r,
    worst_trade_r: statsCore.worst_trade_r,
    // Preserve signal diagnostics from the underlying engine when available
    filtered_signals: base.stats.filtered_signals,
    total_signals: base.stats.total_signals,
    filter_reasons: base.stats.filter_reasons,
    equity_curve: (statsCore as any).equity_curve ?? base.stats.equity_curve,
  };

  return {
    symbol: base.symbol,
    timeframe_used: base.timeframe_used,
    bars_loaded: base.bars_loaded,
    trades: trades as any,
    stats,
    anomalies: base.anomalies,
  };
}
