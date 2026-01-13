export interface BacktestResultStats {
  trades_total: number;
  win_rate: number;
  avg_r: number;
  max_drawdown: number;
  best_trade_r: number | null;
  worst_trade_r: number | null;
  equity_curve?: Array<{ t: number; balance: number }>;
}

export interface BacktestResult {
  timeframe_used: string;
  bars_loaded: number;
  stats: BacktestResultStats;
  trades: any[];
  anomalies: string[];
}

export interface BacktestResultsPayload {
  symbol: string;
  version: string; // e.g. "V4.6"
  day?: BacktestResult | null;
  swing?: BacktestResult | null;
  invest?: BacktestResult | null;
}
