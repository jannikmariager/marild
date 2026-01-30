import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export type MarketDataType = 'QUOTE' | 'OHLC' | 'OTHER';

export interface MarketDataEvent {
  symbol: string;
  dataType: MarketDataType;
  source: string;
  provider?: string | null;
  fetchedAt?: string | Date;
  dataTimestamp?: string | Date | null;
  stalenessSeconds?: number | null;
  context?: string | null;
  metadata?: Record<string, unknown> | null;
}

function toIso(value?: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export async function recordMarketDataEvent(
  supabase: SupabaseClient,
  event: MarketDataEvent,
): Promise<void> {
  try {
    const { symbol, dataType, source } = event;
    if (!symbol || !dataType || !source) {
      console.warn('[recordMarketDataEvent] Missing required fields', event);
      return;
    }

    const fetchedAtIso = toIso(event.fetchedAt) ?? new Date().toISOString();
    const dataTimestampIso = toIso(event.dataTimestamp);

    const payload = {
      symbol: symbol.toUpperCase(),
      data_type: dataType,
      source,
      provider: event.provider ?? null,
      fetched_at: fetchedAtIso,
      data_timestamp: dataTimestampIso,
      staleness_seconds: event.stalenessSeconds ?? null,
      context: event.context ?? null,
      metadata: event.metadata ?? {},
    };

    const { error } = await supabase.from('market_data_diagnostics').insert(payload);
    if (error) {
      console.warn('[recordMarketDataEvent] Insert failed', error.message);
    }
  } catch (error) {
    console.warn('[recordMarketDataEvent] Error recording diagnostics', error);
  }
}
