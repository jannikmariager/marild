export type BacktestEngineType = "DAYTRADER" | "SWING" | "INVESTOR";

export interface BacktestV4Request {
  engine_type: BacktestEngineType;
  horizon_days: number;
  tickers: string[]; // symbols like ["AAPL","MSTR",...]
}

// Per-symbol result returned by the Next.js /api/backtest/v4 route
export interface BacktestV4SymbolResult {
  symbol: string;
  engine_type: BacktestEngineType;

  timeframe_used: string; // e.g. "1m", "4h", "1d"
  bars_loaded: number;

  // Summary stats (mirrors BacktestStatsV4 from the Edge function)
  trades_total: number;
  win_rate: number; // in %
  avg_r: number; // average R per trade
  max_drawdown: number; // % drawdown
  equity_ok?: boolean; // derived from equity curve sanity check

  fallback_used: boolean; // true if loader had to fall back to a secondary timeframe
  anomalies: string[];

  // Optional detailed fields from the Edge function (included when available)
  error?: string; // e.g. "NO_BARS", "INSUFFICIENT_DATA"

  stats_full?: {
    trades_total: number;
    win_rate: number;
    avg_r: number;
    max_drawdown: number;
    best_trade_r: number | null;
    worst_trade_r: number | null;
    equity_curve: Array<{ t: number; balance: number }>;
    filtered_signals?: number;
    total_signals?: number;
    filter_reasons?: Record<string, number>;
  };

  trades?: Array<{
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    sl: number;
    tp: number;
    direction: "long" | "short";
    rMultiple: number;
    pnl: number;
    win: boolean;
  }>;
}

export interface BacktestV4Response {
  horizon_days: number;
  timeframe_priority: string[]; // e.g. ["1m","3m","5m","15m","30m"]
  results: BacktestV4SymbolResult[];
}
