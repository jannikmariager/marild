export const INITIAL_EQUITY = 100_000;

export interface ClosedTrade {
  entry_price: number;
  exit_price: number;
  realized_pnl_dollars: number;
  /**
   * Absolute capital deployed for this trade at entry time.
   * Typically notional_at_entry (price * size). Must be >= 0.
   */
  capital_at_entry?: number | null;
  exit_timestamp: string;
}

export interface PortfolioMetrics {
  currentEquity: number;
  realizedPnl: number;
  realizedPnlPct: number;
  winRateClosedPct: number | null;
  avgTradeReturnPct: number | null;
  profitFactor: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

export function computePortfolioMetrics(
  trades: ClosedTrade[],
  options?: { unrealizedPnlDollars?: number },
): PortfolioMetrics {
  const unrealized = options?.unrealizedPnlDollars ?? 0;

  const totalTrades = trades.length;

  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  let grossProfits = 0;
  let grossLossesAbs = 0;
  let totalCapitalDeployed = 0;

  for (const t of trades) {
    const pnl = t.realized_pnl_dollars ?? 0;
    realizedPnl += pnl;

    if (pnl > 0) {
      wins += 1;
      grossProfits += pnl;
    } else if (pnl < 0) {
      losses += 1;
      grossLossesAbs += Math.abs(pnl);
    }

    const capital = t.capital_at_entry;
    if (typeof capital === 'number' && isFinite(capital) && capital > 0) {
      totalCapitalDeployed += Math.abs(capital);
    }
  }

  const currentEquity = INITIAL_EQUITY + realizedPnl + unrealized;
  const realizedPnlPct = (realizedPnl / INITIAL_EQUITY) * 100;

  const winRateClosedPct = totalTrades > 0 ? (wins / totalTrades) * 100 : null;

  // Capital-weighted average trade return: total_realized_pnl / total_capital_deployed.
  let avgTradeReturnPct: number | null = null;
  if (totalTrades > 0 && totalCapitalDeployed > 0) {
    avgTradeReturnPct = (realizedPnl / totalCapitalDeployed) * 100;
  }

  let profitFactor: number | null = null;
  if (grossProfits > 0 && grossLossesAbs > 0) {
    profitFactor = grossProfits / grossLossesAbs;
  }

  // DEV-only safety checks to ensure direction consistency between P&L and Avg Trade Return.
  if (process.env.NODE_ENV !== 'production' && avgTradeReturnPct != null && realizedPnl !== 0) {
    if (realizedPnl > 0 && avgTradeReturnPct < 0) {
      console.error('[performance/metrics] Inconsistent metrics: realizedPnl > 0 but avgTradeReturnPct < 0', {
        realizedPnl,
        avgTradeReturnPct,
        totalCapitalDeployed,
        totalTrades,
      });
    }
    if (realizedPnl < 0 && avgTradeReturnPct > 0) {
      console.error('[performance/metrics] Inconsistent metrics: realizedPnl < 0 but avgTradeReturnPct > 0', {
        realizedPnl,
        avgTradeReturnPct,
        totalCapitalDeployed,
        totalTrades,
      });
    }
  }

  return {
    currentEquity,
    realizedPnl,
    realizedPnlPct,
    winRateClosedPct,
    avgTradeReturnPct,
    profitFactor,
    totalTrades,
    winningTrades: wins,
    losingTrades: losses,
  };
}
