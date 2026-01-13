export interface EquityEvent {
  timestamp: string; // ISO string
}

// Compute the number of distinct trading days based on equity events and optional start date.
// Trading days are calendar days (in TRADING_TZ) where the portfolio had at least one
// equity mark / open position / closed trade reflected in equityEvents.
// Weekends or days with no equity events are implicitly excluded.
export function calculateTradingDays(
  equityEvents: EquityEvent[],
  options?: { startDateIso?: string; timeZone?: string },
): { tradingDays: number; periodStart: string | null; periodEnd: string | null } {
  const tz = options?.timeZone || 'America/New_York';

  if (!equityEvents || equityEvents.length === 0) {
    const start = options?.startDateIso ?? null;
    return { tradingDays: start ? 1 : 0, periodStart: start, periodEnd: start };
  }

  // Convert timestamps to trading-day keys (YYYY-MM-DD in given time zone)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const dayKeys = new Set<string>();
  let minKey: string | null = null;
  let maxKey: string | null = null;

  for (const e of equityEvents) {
    const d = new Date(e.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = dtf.format(d); // YYYY-MM-DD in trading TZ
    dayKeys.add(key);
    if (!minKey || key < minKey) minKey = key;
    if (!maxKey || key > maxKey) maxKey = key;
  }

  // If a startDateIso is provided and is earlier than the first equity event,
  // use it as the logical start of the period (for display only).
  const startKey = options?.startDateIso ?? minKey;
  const endKey = maxKey ?? startKey;

  return {
    tradingDays: dayKeys.size,
    periodStart: startKey,
    periodEnd: endKey,
  };
}
