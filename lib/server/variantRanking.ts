// Deprecated: variant ranking has moved to the admin-dashboard project.
// Kept only as a minimal shim.

export interface VariantAggregateRow {
  filter_variant: string
  engine_version: string
  avg_win_rate: number | null
  avg_expectancy: number | null
  avg_avg_rr: number | null
  avg_total_return: number | null
  avg_drawdown: number | null
  avg_profit_factor: number | null
  avg_sharpe: number | null
  signals_per_ticker: number | null
  trades_per_ticker: number | null
}

export interface RankedVariantRow extends VariantAggregateRow {
  score: number
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scoreVariant(_v: VariantAggregateRow): number {
  return 0
}

export function rankVariants(list: VariantAggregateRow[]): RankedVariantRow[] {
  return list.map((v) => ({ ...v, score: 0 }))
}
