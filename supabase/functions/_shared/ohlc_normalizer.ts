export interface OHLCBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export function normalizeOHLC(raw: any): OHLCBar | null {
  if (!raw) return null;

  const open =
    raw.open ?? raw.o ?? raw.Open ?? raw.O ?? null;

  const high =
    raw.high ?? raw.h ?? raw.High ?? raw.H ?? null;

  const low =
    raw.low ?? raw.l ?? raw.Low ?? raw.L ?? null;

  const close =
    raw.close ?? raw.c ?? raw.Close ?? raw.C ?? null;

  const volume =
    raw.volume ?? raw.v ?? raw.Volume ?? raw.V ?? null;

  const timestamp =
    raw.timestamp ??
    raw.t ??
    raw.time ??
    raw.T ??
    (raw.datetime ? Date.parse(raw.datetime) : null);

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    timestamp === null
  ) {
    return null;
  }

  const ts = Number(timestamp);
  return {
    open,
    high,
    low,
    close,
    volume,
    timestamp: new Date(ts).toISOString()
  };
}
