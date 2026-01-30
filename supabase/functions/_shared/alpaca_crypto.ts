import { getCryptoShadowConfig } from './config.ts';

type CacheEntry<T> = { ts: number; data: T };

const QUOTE_CACHE = new Map<string, CacheEntry<CryptoQuote>>();
const BARS_CACHE = new Map<string, CacheEntry<CryptoBar[]>>();
const CACHE_TTL_MS = 20_000;

const ALPACA_DATA_BASE =
  (Deno.env.get('APCA_DATA_BASE_URL') || 'https://data.alpaca.markets/v1beta3').replace(/\/$/, '');

export interface CryptoQuote {
  symbol: string;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  last?: number | null;
  ts?: string | null; // ISO UTC
}

export interface CryptoBar {
  ts: string; // ISO UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function authHeaders(): Record<string, string> {
  const key = Deno.env.get('APCA_API_KEY_ID');
  const secret = Deno.env.get('APCA_API_SECRET_KEY');
  if (!key || !secret) {
    throw new Error('Missing APCA_API_KEY_ID or APCA_API_SECRET_KEY for Alpaca crypto data');
  }
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
  };
}

function timeframeToAlpaca(tf: string): string {
  const lower = tf.toLowerCase();
  if (lower === '15m' || lower === '15min') return '15Min';
  if (lower === '1h' || lower === '60m') return '1Hour';
  throw new Error(`Unsupported crypto timeframe: ${tf}`);
}

function canonicalSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, data: T) {
  map.set(key, { ts: Date.now(), data });
}

export async function getCryptoLatest(symbol: string): Promise<CryptoQuote | null> {
  const sym = canonicalSymbol(symbol);
  const cached = cacheGet(QUOTE_CACHE, sym);
  if (cached) return cached;

  const url = `${ALPACA_DATA_BASE}/crypto/us/latest/quotes?symbols=${encodeURIComponent(sym)}`;
  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) {
    console.warn(`[alpaca_crypto] latest quote failed ${resp.status} ${resp.statusText}`);
    return null;
  }
  const json = await resp.json();
  const quote = json?.quotes?.[sym];
  if (!quote) return null;

  const bid = quote.bp ?? null;
  const ask = quote.ap ?? null;
  const mid = bid && ask ? (bid + ask) / 2 : null;
  const last = quote.lp ?? null;
  const out: CryptoQuote = {
    symbol: sym,
    bid,
    ask,
    mid: mid ?? last ?? null,
    last,
    ts: quote.t ? new Date(quote.t).toISOString() : null,
  };
  cacheSet(QUOTE_CACHE, sym, out);
  return out;
}

export async function getCryptoBars(symbol: string, timeframe: string, limit = 300): Promise<CryptoBar[]> {
  const sym = canonicalSymbol(symbol);
  const tf = timeframeToAlpaca(timeframe);
  const key = `${sym}_${tf}_${limit}`;
  const cached = cacheGet(BARS_CACHE, key);
  if (cached) return cached;

  const url = `${ALPACA_DATA_BASE}/crypto/us/bars?symbols=${encodeURIComponent(sym)}&timeframe=${tf}&limit=${limit}`;
  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) {
    console.warn(`[alpaca_crypto] bars failed ${resp.status} ${resp.statusText}`);
    return [];
  }
  const json = await resp.json();
  const bars = (json?.bars?.[sym] || []) as any[];
  const out: CryptoBar[] = bars.map((b) => ({
    ts: new Date(b.t).toISOString(),
    open: Number(b.o),
    high: Number(b.h),
    low: Number(b.l),
    close: Number(b.c),
    volume: Number(b.v ?? 0),
  }));
  cacheSet(BARS_CACHE, key, out);
  return out;
}

export function getCryptoUniverse(): string[] {
  return getCryptoShadowConfig().universe;
}
