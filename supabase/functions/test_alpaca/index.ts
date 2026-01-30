import { corsHeaders } from '../_shared/cors.ts';

interface RequestPayload {
  symbols?: string[];
}

async function runJsonGet(url: string, headers: Record<string, string>) {
  console.log('[test_alpaca] GET', url);
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TSLA'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const symbols = await resolveSymbols(req);
    const result = await fetchSnapshots(symbols);

    return new Response(
      JSON.stringify(result, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[test_alpaca] Failure:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

async function resolveSymbols(req: Request): Promise<string[]> {
  let payload: RequestPayload | null = null;
  try {
    payload = await req.json();
  } catch {
    // ignore body parse errors (likely no body)
  }

  const url = new URL(req.url);
  const qpSymbols = url.searchParams.get('symbols');

  const symbols = payload?.symbols?.length
    ? payload.symbols
    : qpSymbols
      ? qpSymbols.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_SYMBOLS;

  const normalized = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  );

  if (!normalized.length) {
    throw new Error('No symbols supplied');
  }

  return normalized.slice(0, 50);
}

async function fetchSnapshots(symbols: string[]) {
  const key = Deno.env.get('APCA_API_KEY_ID');
  const secret = Deno.env.get('APCA_API_SECRET_KEY');
  const tradingBase = (Deno.env.get('APCA_API_BASE_URL')?.trim() || 'https://paper-api.alpaca.markets/v2').replace(/\/$/, '');
  const dataBase = (Deno.env.get('APCA_DATA_BASE_URL')?.trim() || 'https://data.alpaca.markets/v2').replace(/\/$/, '');

  if (!key || !secret) {
    throw new Error('APCA_API_KEY_ID or APCA_API_SECRET_KEY not configured in secrets');
  }

  const headers = {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
  };

  const tradingChecks = await Promise.all([
    runJsonGet(`${tradingBase}/account`, headers),
    runJsonGet(`${tradingBase}/clock`, headers),
  ]);

  const snapshots = await runJsonGet(`${dataBase}/stocks/snapshots?symbols=${symbols.join(',')}`, headers);

  const snapshotsBody = extractSnapshots(snapshots.body);

  return {
    trading_base: tradingBase,
    data_base: dataBase,
    trading_checks: [
      { endpoint: 'account', ...tradingChecks[0] },
      { endpoint: 'clock', ...tradingChecks[1] },
    ],
    data_snapshot: {
      endpoint: 'stocks/snapshots',
      status: snapshots.status,
      ok: snapshots.ok,
      returned: snapshotsBody ? Object.keys(snapshotsBody).length : 0,
      sample: snapshotsBody ? snapshotsBody[symbols[0]] ?? null : null,
      body: snapshots.body,
    },
  };
}

function extractSnapshots(body: unknown): Record<string, any> | null {
  if (!body || typeof body !== 'object') return null;
  if ('snapshots' in body) {
    const snapshots = (body as { snapshots?: Record<string, any> }).snapshots;
    if (snapshots && typeof snapshots === 'object') {
      return snapshots;
    }
  }
  const upperKeys = Object.keys(body as Record<string, any>).filter((key) => /^[A-Z0-9.:-]+$/.test(key));
  if (upperKeys.length) {
    return body as Record<string, any>;
  }
  return null;
}
