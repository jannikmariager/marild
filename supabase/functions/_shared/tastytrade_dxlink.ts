/**
 * Lightweight Tastytrade DXLink WebSocket client used for testing and
 * prototyping. This handles OAuth refresh, DXLink token retrieval and
 * minimal Quote subscriptions.
 *
 * NOTE: This module is intentionally self contained so we can experiment
 * without touching the existing Yahoo / IB data pipelines.
 */

type QuoteEvent = {
  eventSymbol: string;
  eventTime?: number;
  bidPrice?: number;
  bidSize?: number;
  askPrice?: number;
  askSize?: number;
  bidExchangeCode?: string;
  askExchangeCode?: string;
  bidTime?: number;
  askTime?: number;
  [key: string]: unknown;
};

type ChannelState = 'CHANNEL_OPENED' | 'CHANNEL_CLOSED' | 'CHANNEL_PENDING';

interface TastytradeClientOptions {
  refreshToken: string;
  clientSecret: string;
  clientId?: string;
  isTest?: boolean;
  logger?: (message: string, payload?: Record<string, unknown>) => void;
}

const PROD_BASE_URL = 'https://api.tastyworks.com';
const CERT_BASE_URL = 'https://api.cert.tastyworks.com';
const ACCEPT_VERSION = '20251101';
const CHANNEL_MAP: Record<string, number> = {
  Candle: 1,
  Greeks: 3,
  Profile: 5,
  Quote: 7,
  Summary: 9,
  TheoPrice: 11,
  TimeAndSale: 13,
  Trade: 15,
  Underlying: 17,
};

const CHANNEL_ID_TO_EVENT = Object.entries(CHANNEL_MAP).reduce<Record<number, string>>(
  (acc, [event, id]) => {
    acc[id] = event;
    return acc;
  },
  {},
);

const ACCEPT_FIELDS: Record<string, string[]> = {
  Quote: [
    'eventSymbol',
    'eventTime',
    'sequence',
    'time',
    'timeNanoPart',
    'bidPrice',
    'bidSize',
    'bidExchangeCode',
    'bidTime',
    'askPrice',
    'askSize',
    'askExchangeCode',
    'askTime',
    'lastPrice',
    'lastSize',
    'openPrice',
    'highPrice',
    'lowPrice',
    'closePrice',
  ],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TastytradeDxlinkClient {
  private readonly baseUrl: string;
  private sessionToken?: string;
  private sessionExpiration = 0;
  private streamerToken?: string;
  private streamerExpiration = 0;
  private dxlinkUrl?: string;
  private websocket?: WebSocket;
  private heartbeatTimer?: number;
  private authenticated = false;
  private authResolver?: () => void;
  private authRejecter?: (error: Error) => void;
  private authPromise?: Promise<void>;
  private subscriptionState = new Map<string, ChannelState>();
  private channelResolvers = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private quoteHandlers = new Set<(quote: QuoteEvent) => void>();

  constructor(private readonly options: TastytradeClientOptions) {
    if (!options.refreshToken) {
      throw new Error('TASTY_REFRESH_TOKEN is required');
    }
    if (!options.clientSecret) {
      throw new Error('TASTY_CLIENT_SECRET is required');
    }
    this.baseUrl = options.isTest ? CERT_BASE_URL : PROD_BASE_URL;
  }

  async connect(): Promise<void> {
    await this.refreshSessionToken();
    await this.refreshStreamerToken();
    await this.openWebSocket();
    await this.waitForAuth();
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }
    this.authenticated = false;
  }

  onQuote(handler: (quote: QuoteEvent) => void): () => void {
    this.quoteHandlers.add(handler);
    return () => this.quoteHandlers.delete(handler);
  }

  async collectQuotes(
    symbols: string[],
    opts: { expected?: number; timeoutMs?: number } = {},
  ): Promise<QuoteEvent[]> {
    const expected = opts.expected ?? 5;
    const timeoutMs = opts.timeoutMs ?? 10000;
    const results: QuoteEvent[] = [];
    const symbolSet = new Set(symbols.map((s) => s.toUpperCase()));

    await this.subscribeQuotes(symbols);

    return await new Promise<QuoteEvent[]>((resolve) => {
      const dispose = this.onQuote((quote) => {
        if (!symbolSet.has((quote.eventSymbol || '').toUpperCase())) {
          return;
        }
        results.push(quote);
        if (results.length >= expected) {
          dispose();
          clearTimeout(timer);
          resolve(results);
        }
      });

      const timer = setTimeout(() => {
        dispose();
        resolve(results);
      }, timeoutMs);
    });
  }

  async subscribeQuotes(symbols: string[], refreshInterval = 0.1): Promise<void> {
    if (!symbols.length) return;
    await this.ensureChannel('Quote', refreshInterval);
    const channel = CHANNEL_MAP['Quote'];
    const chunks = chunkArray(symbols, 50);
    for (const chunk of chunks) {
      const message = {
        type: 'FEED_SUBSCRIPTION',
        channel,
        add: chunk.map((symbol) => ({ symbol, type: 'Quote' })),
      };
      this.send(message);
      // Allow DXLink to process large subscribe batches
      await sleep(50);
    }
  }

  private async refreshSessionToken(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: this.buildHeaders(false),
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.options.refreshToken,
        client_secret: this.options.clientSecret,
        ...(this.options.clientId ? { client_id: this.options.clientId } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to refresh session token: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    this.sessionToken = data['access_token'];
    const expiresIn = Number(data['expires_in'] ?? 900);
    this.sessionExpiration = Date.now() + expiresIn * 1000;
    this.log('Refreshed session token', { expiresIn });
  }

  private async refreshStreamerToken(): Promise<void> {
    if (!this.sessionToken) throw new Error('Session token missing');
    const response = await fetch(`${this.baseUrl}/api-quote-tokens`, {
      method: 'GET',
      headers: this.buildHeaders(true),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch quote token: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    const data = payload['data'] ?? payload;
    this.streamerToken = data['token'];
    this.dxlinkUrl = data['dxlink-url'];
    const expiresAt = data['expires-at'];
    this.streamerExpiration = expiresAt ? Date.parse(expiresAt) : Date.now() + 3600 * 1000;
    this.log('Fetched DXLink token', { dxlinkUrl: this.dxlinkUrl });
  }

  private async openWebSocket(): Promise<void> {
    if (!this.dxlinkUrl || !this.streamerToken) {
      throw new Error('DXLink URL or token missing');
    }
    const ws = new WebSocket(this.dxlinkUrl);
    this.websocket = ws;

    this.authPromise = new Promise<void>((resolve, reject) => {
      this.authResolver = resolve;
      this.authRejecter = reject;
    });

    ws.addEventListener('message', (event) => this.handleMessage(event));
    ws.addEventListener('close', () => {
      this.log('DXLink websocket closed');
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
    });
    ws.addEventListener('error', (event) => {
      const error = new Error(`DXLink websocket error: ${JSON.stringify(event)}`);
      this.authRejecter?.(error);
      this.log(error.message);
    });

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener(
        'error',
        () => reject(new Error('DXLink websocket failed to open')),
        { once: true },
      );
    });

    this.send({
      type: 'SETUP',
      channel: 0,
      keepaliveTimeout: 60,
      acceptKeepaliveTimeout: 60,
      version: '0.1-DXF-JS/0.3.0',
    });
    this.send({
      type: 'AUTH',
      channel: 0,
      token: this.streamerToken,
    });

    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'KEEPALIVE', channel: 0 });
    }, 30000);
  }

  private async waitForAuth(): Promise<void> {
    await Promise.race([
      this.authPromise,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('DXLink auth timeout')), 5000),
      ),
    ]);
    this.authenticated = true;
    this.log('DXLink authenticated');
  }

  private async ensureChannel(eventType: string, refreshInterval: number): Promise<void> {
    const current = this.subscriptionState.get(eventType);
    if (current === 'CHANNEL_OPENED') {
      return;
    }
    if (!this.channelResolvers.has(eventType)) {
      const promise = new Promise<void>((resolve, reject) => {
        this.channelResolvers.set(eventType, { resolve, reject });
      });
      this.subscriptionState.set(eventType, 'CHANNEL_PENDING');
      this.send({
        type: 'CHANNEL_REQUEST',
        channel: CHANNEL_MAP[eventType],
        service: 'FEED',
        parameters: { contract: 'AUTO' },
      });
      await promise;
      await this.sendFeedSetup(eventType, refreshInterval);
    } else {
      const { resolve } = this.channelResolvers.get(eventType)!;
      if (!resolve) return;
    }
  }

  private async sendFeedSetup(eventType: string, refreshInterval: number): Promise<void> {
    const message: Record<string, unknown> = {
      type: 'FEED_SETUP',
      channel: CHANNEL_MAP[eventType],
      acceptAggregationPeriod: refreshInterval,
      acceptDataFormat: 'JSON',
    };
    const fields = ACCEPT_FIELDS[eventType];
    if (fields) {
      message['acceptEventFields'] = { [eventType]: fields };
    }
    this.send(message);
    await sleep(50);
  }

  private handleMessage(event: MessageEvent<string>): void {
    try {
      const message = JSON.parse(event.data);
      const type = message['type'];
      switch (type) {
        case 'AUTH_STATE': {
          if (message['state'] === 'AUTHORIZED') {
            this.authResolver?.();
          } else if (message['state'] === 'FAILED') {
            this.authRejecter?.(new Error('DXLink auth failed'));
          }
          break;
        }
        case 'CHANNEL_OPENED': {
          const channelId = Number(message['channel']);
          const eventType = CHANNEL_ID_TO_EVENT[channelId];
          if (eventType) {
            this.subscriptionState.set(eventType, 'CHANNEL_OPENED');
            const resolver = this.channelResolvers.get(eventType);
            resolver?.resolve();
            this.channelResolvers.delete(eventType);
            this.log(`Channel opened`, { eventType, channelId });
          }
          break;
        }
        case 'CHANNEL_CLOSED': {
          const channelId = Number(message['channel']);
          const eventType = CHANNEL_ID_TO_EVENT[channelId];
          if (eventType) {
            this.subscriptionState.set(eventType, 'CHANNEL_CLOSED');
            this.log(`Channel closed`, { eventType, channelId });
          }
          break;
        }
        case 'FEED_DATA': {
          this.handleFeedData(message);
          break;
        }
        case 'ERROR': {
          const errorMessage = message['message'] || JSON.stringify(message);
          this.log(`DXLink error: ${errorMessage}`);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      this.log(`Failed to parse DXLink message: ${(error as Error).message}`);
    }
  }

  private handleFeedData(message: Record<string, unknown>): void {
    const channelId = Number(message['channel']);
    const eventType = CHANNEL_ID_TO_EVENT[channelId];
    if (eventType !== 'Quote') return;
    const data = message['data'];
    if (!Array.isArray(data)) return;
    for (const item of data) {
      const quote = this.normalizeQuote(item);
      if (quote) {
        for (const handler of this.quoteHandlers) {
          handler(quote);
        }
      }
    }
  }

  private normalizeQuote(entry: unknown): QuoteEvent | null {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      const get = (key: string) => obj[key] ?? obj[snakeToCamel(key)] ?? obj[camelToSnake(key)];
      const eventSymbol = String(get('eventSymbol') ?? '');
      if (!eventSymbol) return null;
      return {
        eventSymbol,
        eventTime: toNumber(get('eventTime')),
        bidPrice: toNumber(get('bidPrice')),
        bidSize: toNumber(get('bidSize')),
        askPrice: toNumber(get('askPrice')),
        askSize: toNumber(get('askSize')),
        bidExchangeCode: stringOrUndefined(get('bidExchangeCode')),
        askExchangeCode: stringOrUndefined(get('askExchangeCode')),
        bidTime: toNumber(get('bidTime')),
        askTime: toNumber(get('askTime')),
        lastPrice: toNumber(get('lastPrice')),
        lastSize: toNumber(get('lastSize')),
        openPrice: toNumber(get('openPrice')),
        highPrice: toNumber(get('highPrice')),
        lowPrice: toNumber(get('lowPrice')),
        closePrice: toNumber(get('closePrice')),
      };
    }
    return null;
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.websocket) throw new Error('DXLink websocket not connected');
    this.websocket.send(JSON.stringify(payload));
  }

  private buildHeaders(includeAuth: boolean): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (!this.options.isTest) {
      headers['Accept-Version'] = ACCEPT_VERSION;
    }
    if (includeAuth && this.sessionToken) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    }
    return headers;
  }

  private log(message: string, payload?: Record<string, unknown>) {
    if (this.options.logger) {
      this.options.logger(message, payload);
    } else if (payload) {
      console.log(`[tastytrade-dxlink] ${message}`, payload);
    } else {
      console.log(`[tastytrade-dxlink] ${message}`);
    }
  }
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  if (values.length <= chunkSize) return [values];
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    result.push(values.slice(i, i + chunkSize));
  }
  return result;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
