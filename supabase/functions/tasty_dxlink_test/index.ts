import { TastytradeDxlinkClient } from '../_shared/tastytrade_dxlink.ts';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ'];

function getEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`${key} environment variable is required`);
  }
  return value;
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get('symbols');
  const symbols = symbolsParam
    ? symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SYMBOLS;

  let client: TastytradeDxlinkClient | undefined;

  try {
    client = new TastytradeDxlinkClient({
      refreshToken: getEnv('TASTY_REFRESH_TOKEN'),
      clientSecret: getEnv('TASTY_CLIENT_SECRET'),
      clientId: Deno.env.get('TASTY_CLIENT_ID') ?? undefined,
      isTest: Deno.env.get('TASTY_API_ENV') === 'cert',
    });

    await client.connect();
    const quotes = await client.collectQuotes(symbols.slice(0, 5), {
      expected: 3,
      timeoutMs: 7000,
    });

    return json({
      ok: true,
      symbols: symbols.slice(0, 5),
      quotes,
      received: quotes.length,
    });
  } catch (error) {
    console.error('[tasty_dxlink_test]', error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  } finally {
    if (client) {
      await client.disconnect().catch((err) => {
        console.warn('[tasty_dxlink_test] disconnect error', err);
      });
    }
  }
});
