import { loadUnifiedOHLC } from "../_shared/ohlc_loader.ts";
import { runBacktestV4Router, type HighLevelEngineVersion } from "../_shared/backtest/v4_router.ts";
import { CURRENT_BACKTEST_ENGINE, getEngineVersionForStyle } from "../_shared/backtest/engine_version.ts";
import { type EngineType, type OHLCBar } from "../_shared/signal_types.ts";

export interface LocalBacktestArgs {
  symbol: string;
  engine_type: EngineType; // 'DAYTRADER' | 'SWING' | 'INVESTOR'
  timeframe: string;       // e.g. '1m', '4h', '1d'
  horizon_days: number;
  local?: boolean;
  starting_equity?: number;
}

async function buildBacktestResponse(
  symbol: string,
  timeframe: string,
  bars: OHLCBar[],
  engine_type: EngineType,
  starting_equity?: number,
) {
  if (!bars || bars.length === 0) {
    return {
      symbol,
      timeframe_used: timeframe,
      bars_loaded: 0,
      trades: [],
      stats: {
        trades_total: 0,
        win_rate: 0,
        avg_r: 0,
        max_drawdown: 0,
        best_trade_r: null,
        worst_trade_r: null,
        equity_curve: [],
      },
      anomalies: ["no_bars_loaded"],
    };
  }

  const envOverride = Deno.env.get("BACKTEST_ENGINE") as HighLevelEngineVersion | undefined;
  const highLevelVersion: HighLevelEngineVersion = envOverride ?? getEngineVersionForStyle(engine_type);

  const result = await runBacktestV4Router(
    highLevelVersion,
    {
      engine_type,
      engine_version: "V4_1",
      symbol,
      timeframe,
      starting_equity,
    },
    bars,
  );

  return result;
}

export async function runBacktestV4(args: LocalBacktestArgs) {
  const symbol = args.symbol.toUpperCase();
  const timeframe = args.timeframe.toLowerCase();

  const bars = await loadUnifiedOHLC(symbol, timeframe as any, args.horizon_days);

  return await buildBacktestResponse(
    symbol,
    timeframe,
    bars,
    args.engine_type,
    args.starting_equity,
  );
}
