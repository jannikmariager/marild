import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const DEFAULT_REST_BASE = 'https://data.alpaca.markets/v2';
const DEFAULT_WS_URL = 'wss://stream.data.alpaca.markets/v2/iex';

export interface AlpacaQuote {
  symbol: string;
  bidPrice?: number | null;
  bidSize?: number | null;
  askPrice?: number | null;
  askSize?: number | null;
  lastPrice?: number | null;
  lastSize?: number | null;
  lastTimestamp?: string | null;
  mid?: number | null;
  dayVolume?: number | null;
}

function extractSnapshotMap(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null;
  if ('snapshots' in payload) {
    const value = (payload as { snapshots?: Record<string, any> }).snapshots;
    if (value && typeof value === 'object') {
      return value;
    }
  }
  const entries = payload as Record<string, any>;
  const keys = Object.keys(entries).filter((key) => /^[A-Z0-9._-]+$/.test(key));
  if (keys.length) {
    return entries;
  }
  return null;
}

export interface QuoteStreamOptions {
  symbols: string[];
  onQuote: (quote: AlpacaQuote) => Promise<void> | void;
  onStatus?: (status: string) => void;
  onError?: (error: unknown) => void;
  wsUrl?: string;
}

interface AlpacaAuthHeaders {
  'APCA-API-KEY-ID': string;
  'APCA-API-SECRET-KEY': string;
}

function getAuthHeaders(): AlpacaAuthHeaders {
  const key = Deno.env.get('APCA_API_KEY_ID');
  const secret = Deno.env.get('APCA_API_SECRET_KEY');

  if (!key || !secret) {
    throw new Error('Missing APCA_API_KEY_ID or APCA_API_SECRET_KEY environment variables');
  }

  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
  };
}

function getMarketDataBase(): string {
  const base = Deno.env.get('APCA_DATA_BASE_URL') || DEFAULT_REST_BASE;
  return base.replace(/\/$/, '');
}

export async function fetchAlpacaSnapshots(symbols: string[], chunkSize = 50): Promise<Record<string, AlpacaQuote>> {
  if (symbols.length === 0) {
    return {};
  }

  const headers = getAuthHeaders();
  const primaryBase = getMarketDataBase();
  const bases = primaryBase === DEFAULT_REST_BASE ? [primaryBase] : [primaryBase, DEFAULT_REST_BASE];
  const normalized = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()))).filter(Boolean);

  const results: Record<string, AlpacaQuote> = {};

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const batch = normalized.slice(i, i + chunkSize);
    let payload: any = null;
    let responseOk = false;

    for (const base of bases) {
      const url = `${base}/stocks/snapshots?symbols=${batch.join(',')}`;
      const response = await fetch(url, { headers });
      if (response.ok) {
        payload = await response.json();
        responseOk = true;
        break;
      }
      console.warn(`[fetchAlpacaSnapshots] ${url} -> ${response.status} ${response.statusText}`);
    }

    if (!responseOk || !payload) {
      throw new Error('Alpaca snapshot fetch failed (no host responded with data)');
    }
    const snapshots = extractSnapshotMap(payload);
    if (!snapshots) {
      console.warn('[fetchAlpacaSnapshots] Response missing snapshots field');
      continue;
    }

    for (const symbol of batch) {
      const snap = snapshots[symbol];
      if (!snap) continue;

      const quote: AlpacaQuote = {
        symbol,
        bidPrice: snap.latestQuote?.bp ?? null,
        bidSize: snap.latestQuote?.bs ?? null,
        askPrice: snap.latestQuote?.ap ?? null,
        askSize: snap.latestQuote?.as ?? null,
        lastPrice: snap.latestTrade?.p ?? null,
        lastSize: snap.latestTrade?.s ?? null,
        lastTimestamp: snap.latestTrade?.t ?? null,
        dayVolume: snap.minuteBar?.v ?? snap.dailyBar?.v ?? null,
      };

      if (quote.bidPrice && quote.askPrice) {
        quote.mid = Number(((quote.bidPrice + quote.askPrice) / 2).toFixed(4));
      } else {
        quote.mid = quote.lastPrice ?? null;
      }

      results[symbol] = quote;
    }
  }

  return results;
}

export async function upsertRealtimeQuotes(
  supabase: SupabaseClient,
  quotes: AlpacaQuote[],
): Promise<void> {
  if (!quotes.length) return;

  const rows = quotes.map((q) => ({
    symbol: q.symbol,
    source: 'ALPACA',
    bid_price: q.bidPrice ?? null,
    bid_size: q.bidSize ?? null,
    ask_price: q.askPrice ?? null,
    ask_size: q.askSize ?? null,
    last_trade_price: q.lastPrice ?? null,
    last_trade_size: q.lastSize ?? null,
    last_trade_ts: q.lastTimestamp ? new Date(q.lastTimestamp).toISOString() : null,
    mid_price: q.mid ?? null,
    day_volume: q.dayVolume ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('realtime_market_data')
    .upsert(rows, { onConflict: 'symbol' });

  if (error) {
    throw error;
  }
}

export async function getRealtimeQuote(
  supabase: SupabaseClient,
  symbol: string,
  maxAgeMs = 60_000,
): Promise<AlpacaQuote | null> {
  const normalized = symbol.trim().toUpperCase();
  const { data, error } = await supabase
    .from('realtime_market_data')
    .select('*')
    .eq('symbol', normalized)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const updatedAt = data.updated_at ? Date.parse(data.updated_at) : NaN;
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > maxAgeMs) {
    return null;
  }

  return {
    symbol: data.symbol,
    bidPrice: data.bid_price,
    bidSize: data.bid_size,
    askPrice: data.ask_price,
    askSize: data.ask_size,
    lastPrice: data.last_trade_price,
    lastSize: data.last_trade_size,
    lastTimestamp: data.last_trade_ts,
    mid: data.mid_price,
    dayVolume: data.day_volume,
  };
}

export class AlpacaQuoteStream {
  private ws: WebSocket | null = null;
  private readonly symbols: string[];
  private readonly onQuote: QuoteStreamOptions['onQuote'];
  private readonly onStatus?: QuoteStreamOptions['onStatus'];
  private readonly onError?: QuoteStreamOptions['onError'];
  private readonly wsUrl: string;
  private heartbeatInterval: number | null = null;

  constructor(options: QuoteStreamOptions) {
    if (!options.symbols.length) {
      throw new Error('AlpacaQuoteStream requires at least one symbol');
    }
    this.symbols = Array.from(new Set(options.symbols.map((s) => s.trim().toUpperCase()))).filter(Boolean);
    this.onQuote = options.onQuote;
    this.onStatus = options.onStatus;
    this.onError = options.onError;
    this.wsUrl = options.wsUrl || Deno.env.get('APCA_DATA_WS_URL') || DEFAULT_WS_URL;
  }

  async start(): Promise<void> {
    const headers = getAuthHeaders();
    const ws = new WebSocket(this.wsUrl, [], { headers });
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus?.('connected');
      this.auth();
    };

    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    ws.onerror = (event) => {
      this.onError?.(event);
    };

    ws.onclose = () => {
      this.onStatus?.('closed');
      this.clearHeartbeat();
      this.ws = null;
    };
  }

  stop(): void {
    this.clearHeartbeat();
    this.ws?.close(1000, 'client disconnect');
    this.ws = null;
  }

  private auth() {
    if (!this.ws) return;
    const key = Deno.env.get('APCA_API_KEY_ID');
    const secret = Deno.env.get('APCA_API_SECRET_KEY');
    if (!key || !secret) {
      throw new Error('Missing Alpaca credentials');
    }

    const authPayload = { action: 'auth', key, secret };
    this.ws.send(JSON.stringify(authPayload));
  }

  private subscribe() {
    if (!this.ws) return;
    const payload = { action: 'subscribe', quotes: this.symbols };
    this.ws.send(JSON.stringify(payload));
    this.onStatus?.(`subscribed:${this.symbols.length}`);
    this.startHeartbeat();
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws) return;
      this.ws.send(JSON.stringify({ action: 'ping' }));
    }, 25_000);
  }

  private clearHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleMessage(raw: string | ArrayBufferLike | Blob) {
    if (typeof raw !== 'string') {
      return;
    }

    try {
      const payload = JSON.parse(raw);
      if (!Array.isArray(payload)) {
        return;
      }

      for (const evt of payload) {
        if (evt.msg === 'connected') {
          this.onStatus?.('auth_required');
        } else if (evt.msg === 'authenticated') {
          this.onStatus?.('authenticated');
          this.subscribe();
        } else if (evt.msg === 'subscription') {
          this.onStatus?.('subscription_confirmed');
        } else if (evt.T === 'q') {
          const quote: AlpacaQuote = {
            symbol: evt.S,
            bidPrice: evt.bp,
            bidSize: evt.bs,
            askPrice: evt.ap,
            askSize: evt.as,
            lastPrice: evt.bp && evt.ap ? (evt.bp + evt.ap) / 2 : undefined,
            lastTimestamp: evt.t,
            mid: evt.bp && evt.ap ? Number(((evt.bp + evt.ap) / 2).toFixed(4)) : evt.bp ?? evt.ap ?? null,
          };
          void this.onQuote(quote);
        } else if (evt.T === 'error') {
          this.onError?.(evt);
        }
      }
    } catch (error) {
      this.onError?.(error);
    }
  }
}
