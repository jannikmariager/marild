/**
 * Type definitions for AI Backtest Engine
 * Deterministic historical simulation - NO OpenAI calls
 */

// Raw OHLC candle data from Yahoo
export interface OHLCBar {
  t: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Backtest input parameters
export interface BacktestParams {
  symbol: string;
  timeframe: "1D"; // Only daily for v1
  horizonDays: 30 | 60 | 90;
}

// Individual trade record
export interface BacktestTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number | null;
  exitReason?: "STOP_LOSS" | "TAKE_PROFIT" | "END_OF_PERIOD"; // Why trade closed
  pnlPct: number | null; // Percentage return
  openedAt: string; // ISO timestamp
  closedAt: string | null; // ISO timestamp or null if still open
  durationHours: number | null; // Hours between open and close
  confidenceScore: number | null; // 0-100, derived from signal strength
  riskMode: "low" | "medium" | "high"; // Based on volatility at entry
}

// Summary statistics
export interface BacktestStats {
  profitPct: number; // Total return percentage (legacy, same as totalReturn)
  totalReturn?: number; // Total return percentage (from Edge Function)
  winRatePct: number; // Percentage of winning trades (legacy)
  winRate?: number; // Percentage of winning trades (from Edge Function)
  maxDrawdownPct: number; // Maximum peak-to-trough drawdown (legacy)
  maxDrawdown?: number; // Maximum peak-to-trough drawdown (from Edge Function)
  sharpeRatio?: number; // Risk-adjusted return metric
  tradesCount: number; // Total number of trades (legacy)
  totalTrades?: number; // Total number of trades (from Edge Function)
  avgTradeDurationHours: number | null; // Average hours per trade
  avgR?: number; // Average R-multiple per trade (engine-specific)
  tp1HitRate?: number; // TP1 hit rate percentage (engine-specific)
  tp2HitRate?: number; // TP2 hit rate percentage (engine-specific)
  bestTradeR?: number; // Best trade in R-multiples (engine-specific)
  worstTradeR?: number; // Worst trade in R-multiples (engine-specific)
  bestTrade?: {
    symbol: string;
    pnlPct: number;
    openedAt: string;
    closedAt: string;
  };
  worstTrade?: {
    symbol: string;
    pnlPct: number;
    openedAt: string;
    closedAt: string;
  };
}

// Equity curve point
export interface EquityCurvePoint {
  t: string; // ISO timestamp
  equity: number; // Portfolio value in dollars
}

// Complete backtest result
export interface BacktestResult {
  stats: BacktestStats;
  equityCurve: EquityCurvePoint[];
  trades: BacktestTrade[];
}

// Intermediate calculation types
export interface TechnicalIndicators {
  ema50: number;
  ema100: number;
  atr: number;
  avgVolume: number;
  volatilityRatio: number; // Current ATR / Average ATR
}

export interface SMCZone {
  type: "support" | "resistance";
  price: number;
  timestamp: number;
  strength: number; // 0-1, how significant this zone is
}

export interface TradeSignal {
  type: "LONG" | "SHORT" | "EXIT";
  confidence: number; // 0-100
  reason: string;
  timestamp: number;
}

// Position tracking during backtest
export interface OpenPosition {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  entryTime: number;
  size: number; // Number of shares
  stopLoss: number;
  takeProfit: number;
  confidenceScore: number;
  riskMode: "low" | "medium" | "high";
}

// Database record shape (matches migration)
export interface BacktestRecord {
  id: string;
  symbol: string;
  timeframe: string;
  horizon_days: number;
  stats: BacktestStats;
  equity_curve: EquityCurvePoint[];
  trades: BacktestTrade[];
  created_at: string;
  updated_at: string;
  computed_at: string;
}
