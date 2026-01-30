import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  fetchAlpacaSnapshots,
  upsertRealtimeQuotes,
} from '../_shared/alpaca_market_data.ts';
import { getWhitelistedTickers, logUniverseStats } from '../_shared/whitelist.ts';

interface RequestPayload {
  symbols?: string[];
  maxSymbols?: number;
  chunkSize?: number;
}

const DEFAULT_MAX_SYMBOLS = Number(Deno.env.get('REALTIME_MAX_SYMBOLS') ?? '400');
const DEFAULT_CHUNK_SIZE = Number(Deno.env.get('REALTIME_CHUNK_SIZE') ?? '50');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: RequestPayload = await parseJson(req);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const symbols = await resolveSymbols(supabase, payload);
    if (!symbols.length) {
      return json(
        {
          ok: true,
          message: 'No symbols resolved; nothing to update',
          updated: 0,
        },
        200,
      );
    }

    const chunkSize = payload.chunkSize && payload.chunkSize > 0
      ? Math.min(payload.chunkSize, 200)
      : DEFAULT_CHUNK_SIZE;

    console.log(
      `[update_realtime_quotes] Fetching ${symbols.length} symbols (chunkSize=${chunkSize})`,
    );

    const snapshots = await fetchAlpacaSnapshots(symbols, chunkSize);
    const quotes = Object.values(snapshots);

    if (!quotes.length) {
      return json(
        {
          ok: false,
          message: 'Fetched 0 Alpaca snapshots',
          requested: symbols.length,
        },
        500,
      );
    }

    await upsertRealtimeQuotes(supabase, quotes);

    const missing = symbols.filter((sym) => !snapshots[sym]);

    return json(
      {
        ok: true,
        requested: symbols.length,
        updated: quotes.length,
        missing,
        next_run_hint: 'scheduled via pg_cron every minute during market hours',
      },
      200,
    );
  } catch (error) {
    console.error('[update_realtime_quotes] Error', error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

async function resolveSymbols(
  supabase: ReturnType<typeof createClient>,
  payload: RequestPayload,
): Promise<string[]> {

  const maxSymbols = Math.max(
    1,
    Math.min(payload.maxSymbols ?? DEFAULT_MAX_SYMBOLS, 1000),
  );

  const whitelist = await getWhitelistedTickers(supabase);
  logUniverseStats('ticker_whitelist', whitelist.length);
  const whitelistSet = new Set(whitelist.map((row) => row.symbol));
  if (whitelist.length === 0) {
    console.warn('[update_realtime_quotes] Whitelist empty; no symbols to update');
    return [];
  }

  if (payload.symbols?.length) {
    const sanitized = sanitizeSymbols(payload.symbols);
    const allowed = sanitized.filter((symbol) => whitelistSet.has(symbol));
    return allowed.slice(0, maxSymbols);
  }

  // Prefer daily focus tickers if available
  const tradeDate = new Date().toISOString().slice(0, 10);
  const { data: focus, error: focusError } = await supabase
    .from('daily_focus_tickers')
    .select('symbol')
    .eq('trade_date', tradeDate)
    .order('rank', { ascending: true })
    .limit(maxSymbols);

  if (focusError) {
    console.warn('[update_realtime_quotes] daily_focus_tickers query failed', focusError.message);
  } else if (focus?.length) {
    console.log(`[update_realtime_quotes] Loaded ${focus.length} focus tickers for ${tradeDate}`);
    return focus
      .map((row) => row.symbol)
      .filter((symbol) => whitelistSet.has(symbol))
      .slice(0, maxSymbols);
  }

  console.log('[update_realtime_quotes] Focus list unavailable, using whitelist fallback');
  return whitelist
    .map((row) => row.symbol)
    .slice(0, maxSymbols);
}

function sanitizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((s) => s?.trim().toUpperCase())
        .filter((s) => !!s && /^[A-Z0-9._-]{1,12}$/.test(s)),
    ),
  );
}

async function parseJson(req: Request): Promise<RequestPayload> {
  try {
    if (req.headers.get('content-length')) {
      return await req.json();
    }
  } catch (err) {
    console.warn('[update_realtime_quotes] Failed to parse JSON body', err);
  }
  return {};
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
