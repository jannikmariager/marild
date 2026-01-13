export interface LivePositionRow {
  entry_price?: number | null;
  size_shares?: number | null;
  stop_loss?: number | null;
  side?: 'LONG' | 'SHORT' | null;
  status?: string | null;
}

export interface ExposureAndRiskResult {
  totalMarketExposure: number;
  riskAtStop: number;
  riskAtStopPct: number;
}

type Options = {
  startingBalance?: number;
  activeStatus?: string;
};

const DEFAULT_ACTIVE_STATUS = 'RISK_ACTIVE';

function toNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function toPositiveInt(value: number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value === 0) return null;
  return value;
}

export function calculateExposureAndRisk(
  rows: LivePositionRow[] | null | undefined,
  options?: Options,
): ExposureAndRiskResult {
  const activeStatus = options?.activeStatus ?? DEFAULT_ACTIVE_STATUS;
  const startingBalance = options?.startingBalance ?? 100_000;

  let totalExposure = 0;
  let totalRisk = 0;

  if (!rows || rows.length === 0) {
    return {
      totalMarketExposure: 0,
      riskAtStop: 0,
      riskAtStopPct: 0,
    };
  }

  for (const row of rows) {
    if (!row) continue;
    const status = row.status ?? DEFAULT_ACTIVE_STATUS;
    if (status !== activeStatus) continue;

    const entryPrice = toNumber(row.entry_price);
    const shares = toPositiveInt(row.size_shares);
    if (entryPrice == null || shares == null) continue;

    totalExposure += Math.abs(entryPrice * shares);

    const stopLoss = toNumber(row.stop_loss);
    if (stopLoss == null) continue;

    const side = row.side === 'SHORT' ? 'SHORT' : 'LONG';
    let positionRisk = 0;

    if (side === 'LONG') {
      const delta = entryPrice - stopLoss;
      if (delta > 0) {
        positionRisk = delta * Math.abs(shares);
      }
    } else {
      const delta = stopLoss - entryPrice;
      if (delta > 0) {
        positionRisk = delta * Math.abs(shares);
      }
    }

    if (positionRisk > 0) {
      totalRisk += positionRisk;
    }
  }

  const riskPct =
    startingBalance > 0 && totalRisk > 0 ? (totalRisk / startingBalance) * 100 : 0;

  return {
    totalMarketExposure: totalExposure,
    riskAtStop: totalRisk,
    riskAtStopPct: riskPct,
  };
}
