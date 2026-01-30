/**
 * Shared Signal Evaluation Utilities
 * Contains reusable functions for evaluating signals and calculating performance metrics
 */

export interface Signal {
  id: string;
  ticker: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  tp1: number;
  tp2: number | null;
  sl: number;
  confidence: number;
  timeframe: string;
  created_at: string;
  evaluated_at?: string | null;
  close_price?: number | null;
  result?: "TP1" | "TP2" | "SL" | "OPEN" | null;
  pl_percentage?: number | null;
}

export interface EvaluationResult {
  result: "TP1" | "TP2" | "SL" | "OPEN";
  pl_percentage: number;
}

export interface PerformanceStats {
  total_signals: number;
  wins: number;
  losses: number;
  open_trades: number;
  win_rate: number;
  total_pl: number;
  average_pl: number;
}

export interface TickerPerformance {
  ticker: string;
  pl_percentage: number;
  signal_count: number;
  direction: "BUY" | "SELL";
}

/**
 * Evaluate a single signal against closing price
 * 
 * BUY Logic:
 * - SL hit if close <= sl
 * - TP2 hit if close >= tp2 (and tp2 exists)
 * - TP1 hit if close >= tp1
 * - Otherwise OPEN
 * 
 * SELL Logic:
 * - SL hit if close >= sl
 * - TP2 hit if close <= tp2 (and tp2 exists)
 * - TP1 hit if close <= tp1
 * - Otherwise OPEN
 */
export function evaluateSignal(signal: Signal, closePrice: number): EvaluationResult {
  const { direction, entry_price, tp1, tp2, sl } = signal;

  let result: "TP1" | "TP2" | "SL" | "OPEN";
  let pl_percentage: number;

  if (direction === "BUY") {
    // BUY signal evaluation
    if (closePrice <= sl) {
      result = "SL";
    } else if (tp2 && closePrice >= tp2) {
      result = "TP2";
    } else if (closePrice >= tp1) {
      result = "TP1";
    } else {
      result = "OPEN";
    }

    // Calculate P/L for BUY: ((close - entry) / entry) * 100
    pl_percentage = ((closePrice - entry_price) / entry_price) * 100;
  } else {
    // SELL signal evaluation
    if (closePrice >= sl) {
      result = "SL";
    } else if (tp2 && closePrice <= tp2) {
      result = "TP2";
    } else if (closePrice <= tp1) {
      result = "TP1";
    } else {
      result = "OPEN";
    }

    // Calculate P/L for SELL: ((entry - close) / entry) * 100
    pl_percentage = ((entry_price - closePrice) / entry_price) * 100;
  }

  return { result, pl_percentage };
}

/**
 * Calculate performance statistics from evaluated signals
 */
export function calculatePerformanceStats(signals: Signal[]): PerformanceStats {
  const evaluatedSignals = signals.filter((s) => s.result && s.pl_percentage !== null);

  const wins = evaluatedSignals.filter((s) => s.result === "TP1" || s.result === "TP2").length;
  const losses = evaluatedSignals.filter((s) => s.result === "SL").length;
  const open_trades = evaluatedSignals.filter((s) => s.result === "OPEN").length;
  
  const win_rate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  
  const total_pl = evaluatedSignals.reduce((sum, s) => sum + (s.pl_percentage || 0), 0);
  const average_pl = evaluatedSignals.length > 0 ? total_pl / evaluatedSignals.length : 0;

  return {
    total_signals: signals.length,
    wins,
    losses,
    open_trades,
    win_rate,
    total_pl,
    average_pl,
  };
}

/**
 * Find best performing ticker from signals
 * Returns ticker with highest P/L percentage
 */
export function findBestPerformer(signals: Signal[]): TickerPerformance | null {
  const evaluatedSignals = signals.filter(
    (s) => s.result && s.pl_percentage !== null && s.pl_percentage > 0
  );

  if (evaluatedSignals.length === 0) return null;

  // Group by ticker and calculate average P/L
  const tickerMap = new Map<string, { total_pl: number; count: number; direction: "BUY" | "SELL" }>();

  for (const signal of evaluatedSignals) {
    const existing = tickerMap.get(signal.ticker);
    if (existing) {
      existing.total_pl += signal.pl_percentage!;
      existing.count += 1;
    } else {
      tickerMap.set(signal.ticker, {
        total_pl: signal.pl_percentage!,
        count: 1,
        direction: signal.direction,
      });
    }
  }

  // Find ticker with highest average P/L
  let bestTicker: string | null = null;
  let bestPL = -Infinity;

  for (const [ticker, data] of tickerMap.entries()) {
    const avgPL = data.total_pl / data.count;
    if (avgPL > bestPL) {
      bestPL = avgPL;
      bestTicker = ticker;
    }
  }

  if (!bestTicker) return null;

  const tickerData = tickerMap.get(bestTicker)!;
  return {
    ticker: bestTicker,
    pl_percentage: tickerData.total_pl / tickerData.count,
    signal_count: tickerData.count,
    direction: tickerData.direction,
  };
}

/**
 * Find worst performing ticker from signals
 * Returns ticker with lowest P/L percentage
 */
export function findWorstPerformer(signals: Signal[]): TickerPerformance | null {
  const evaluatedSignals = signals.filter(
    (s) => s.result && s.pl_percentage !== null
  );

  if (evaluatedSignals.length === 0) return null;

  // Group by ticker and calculate average P/L
  const tickerMap = new Map<string, { total_pl: number; count: number; direction: "BUY" | "SELL" }>();

  for (const signal of evaluatedSignals) {
    const existing = tickerMap.get(signal.ticker);
    if (existing) {
      existing.total_pl += signal.pl_percentage!;
      existing.count += 1;
    } else {
      tickerMap.set(signal.ticker, {
        total_pl: signal.pl_percentage!,
        count: 1,
        direction: signal.direction,
      });
    }
  }

  // Find ticker with lowest average P/L
  let worstTicker: string | null = null;
  let worstPL = Infinity;

  for (const [ticker, data] of tickerMap.entries()) {
    const avgPL = data.total_pl / data.count;
    if (avgPL < worstPL) {
      worstPL = avgPL;
      worstTicker = ticker;
    }
  }

  if (!worstTicker) return null;

  const tickerData = tickerMap.get(worstTicker)!;
  return {
    ticker: worstTicker,
    pl_percentage: tickerData.total_pl / tickerData.count,
    signal_count: tickerData.count,
    direction: tickerData.direction,
  };
}

/**
 * Count BUY vs SELL signals
 */
export function countSignalsByDirection(signals: Signal[]): { buy: number; sell: number } {
  const buy = signals.filter((s) => s.direction === "BUY").length;
  const sell = signals.filter((s) => s.direction === "SELL").length;
  return { buy, sell };
}

/**
 * Get week number for a date
 */
export function getWeekNumber(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week: weekNo, year: d.getUTCFullYear() };
}

/**
 * Get month name from date
 */
export function getMonthName(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
