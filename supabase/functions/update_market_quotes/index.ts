// Edge Function: update_market_quotes
// Fetches live quotes for sector ETFs and upserts into public.market_quotes
// Schedule via Supabase cron to keep dashboard/markets sector widgets fresh.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchBulkQuotes } from '../_shared/yahoo_v8_client.ts';
import { corsHeaders } from '../_shared/cors.ts';

const SECTOR_SYMBOLS = ['XLK','XLF','XLV','XLE','XLY','XLI'] as const;

type SectorSym = (typeof SECTOR_SYMBOLS)[number];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Require service role env for writes
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch quotes from Yahoo v8
    const quotesMap = await fetchBulkQuotes(SECTOR_SYMBOLS as unknown as string[]);

    // Transform and validate
    const nowIso = new Date().toISOString();
    const rows = (SECTOR_SYMBOLS as unknown as string[]).map((sym) => {
      const q = quotesMap[(sym as SectorSym)] || null;
      return {
        symbol: sym,
        price: q?.price ?? null,
        change_percent: q?.changePercent ?? null,
        volume: q?.volume ?? null,
        market_cap: null,
        updated_at: nowIso,
        created_at: nowIso,
      };
    });

    // Upsert into market_quotes (policy allows service_role only)
    const { error } = await supabase
      .from('market_quotes')
      .upsert(rows, { onConflict: 'symbol' });

    if (error) {
      console.error('[update_market_quotes] Upsert error:', error);
      return new Response(
        JSON.stringify({ error: 'UPSERT_FAILED', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        updated: rows.length,
        symbols: SECTOR_SYMBOLS,
        at: nowIso,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[update_market_quotes] Unexpected error:', e);
    return new Response(
      JSON.stringify({ error: 'INTERNAL', message: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
