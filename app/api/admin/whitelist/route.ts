import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { SupabaseClient } from '@supabase/supabase-js';

const ALLOWED_EMAILS = ['jannikmariager@gmail.com'];
const MAX_NOTES_LENGTH = 2000;

export async function GET(request: NextRequest) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAllowed(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  console.log('[whitelist] env check', {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 10),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10),
  });

  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get('q') || '').trim();
  const enabledFilter = searchParams.get('enabled');
  const limit = clampNumber(searchParams.get('limit'), 1, 500, 200);
  const offset = clampNumber(searchParams.get('offset'), 0, 10_000, 0);

  const supabase = supabaseAdmin;
  let query = supabase
    .from('ticker_whitelist')
    .select('symbol, is_enabled, is_top8, manual_priority, notes, created_at, updated_at', { count: 'exact' })
    .order('is_top8', { ascending: false })
    .order('manual_priority', { ascending: false })
    .order('symbol', { ascending: true });

  if (q) {
    query = query.ilike('symbol', `%${q.toUpperCase()}%`);
  }
  if (enabledFilter === 'true') {
    query = query.eq('is_enabled', true);
  } else if (enabledFilter === 'false') {
    query = query.eq('is_enabled', false);
  }

  if (limit > 0) {
    query = query.range(offset, offset + limit - 1);
  }

  const [{ data: rows, error }, stats] = await Promise.all([
    query,
    fetchStats(supabase),
  ]);

  if (error) {
    console.error('[whitelist] GET failed', error.message);
    return NextResponse.json({ error: 'Failed to load whitelist' }, { status: 500 });
  }

  console.log('[whitelist] query result', {
    rows: rows?.length,
    total: stats.total,
    envUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  return NextResponse.json({
    rows: rows ?? [],
    limit,
    offset,
    total: stats.total,
    enabled: stats.enabled,
    top8: stats.top8,
    disabled: Math.max(0, stats.total - stats.enabled),
  });
}

export async function POST(request: NextRequest) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAllowed(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const action = body?.action;
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 });
  }

  const supabase = supabaseAdmin;

  try {
    switch (action) {
      case 'upsert':
        return await handleUpsert(body, supabase);
      case 'bulk_upsert':
        return await handleBulkUpsert(body, supabase);
      case 'set_enabled':
        return await handlePatch(body, supabase, { is_enabled: parseBoolean(body.is_enabled, true) });
      case 'set_top8':
        return await handlePatch(body, supabase, { is_top8: Boolean(body.is_top8) });
      case 'set_priority':
        return await handlePatch(body, supabase, { manual_priority: sanitizePriority(body.manual_priority) });
      case 'set_notes':
        return await handlePatch(body, supabase, { notes: sanitizeNotes(body.notes) });
      case 'delete':
        return await handleDelete(body, supabase);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[whitelist] action failed', action, err);
    if (err instanceof Response) {
      return err;
    }
    return NextResponse.json({ error: (err as Error).message || 'Unexpected error' }, { status: 500 });
  }
}

type WhitelistActionPayload = Record<string, unknown>;
type AdminSupabase = SupabaseClient;

async function handleUpsert(body: WhitelistActionPayload, supabase: AdminSupabase) {
  const symbol = normalizeSymbol(body?.symbol);
  if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });

  const payload = {
    symbol,
    is_enabled: parseBoolean(body?.is_enabled, true),
    is_top8: Boolean(body?.is_top8),
    manual_priority: sanitizePriority(body?.manual_priority),
    notes: sanitizeNotes(body?.notes),
  };

  const { error } = await supabase.from('ticker_whitelist').upsert(payload, { onConflict: 'symbol' });
  if (error) {
    console.error('[whitelist] upsert failed', error.message);
    return NextResponse.json({ error: 'Failed to save symbol' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function handleBulkUpsert(body: WhitelistActionPayload, supabase: AdminSupabase) {
  const raw = typeof body?.text === 'string' ? body.text : '';
  const symbols = new Set<string>();
  for (const chunk of raw.split(/[\n,]/)) {
    const normalized = normalizeSymbol(chunk);
    if (normalized) symbols.add(normalized);
  }
  if (Array.isArray(body?.symbols)) {
    for (const item of body.symbols) {
      const normalized = normalizeSymbol(item);
      if (normalized) symbols.add(normalized);
    }
  }
  if (symbols.size === 0) {
    return NextResponse.json({ error: 'Provide at least one symbol' }, { status: 400 });
  }

  const manual_priority = sanitizePriority(body?.manual_priority);
  const is_enabled = parseBoolean(body?.is_enabled, true);
  const is_top8 = Boolean(body?.is_top8);
  const notes = sanitizeNotes(body?.notes);

  const rows = Array.from(symbols).map((symbol) => ({
    symbol,
    is_enabled,
    is_top8,
    manual_priority,
    notes,
  }));

  const { error } = await supabase.from('ticker_whitelist').upsert(rows, { onConflict: 'symbol' });
  if (error) {
    console.error('[whitelist] bulk upsert failed', error.message);
    return NextResponse.json({ error: 'Failed to import symbols' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: rows.length });
}

async function handlePatch(
  body: WhitelistActionPayload,
  supabase: AdminSupabase,
  patch: Record<string, unknown>,
) {
  const symbol = normalizeSymbol(body?.symbol);
  if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  const { error } = await supabase.from('ticker_whitelist').update(patch).eq('symbol', symbol);
  if (error) {
    console.error('[whitelist] patch failed', symbol, error.message);
    return NextResponse.json({ error: 'Failed to update symbol' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function handleDelete(body: WhitelistActionPayload, supabase: AdminSupabase) {
  const symbol = normalizeSymbol(body?.symbol);
  if (!symbol) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  const { error } = await supabase.from('ticker_whitelist').delete().eq('symbol', symbol);
  if (error) {
    console.error('[whitelist] delete failed', symbol, error.message);
    return NextResponse.json({ error: 'Failed to delete symbol' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function fetchStats(supabase: AdminSupabase) {
  const [totalRes, enabledRes, top8Res] = await Promise.all([
    supabase.from('ticker_whitelist').select('symbol', { count: 'exact', head: true }),
    supabase.from('ticker_whitelist').select('symbol', { count: 'exact', head: true }).eq('is_enabled', true),
    supabase.from('ticker_whitelist').select('symbol', { count: 'exact', head: true }).eq('is_top8', true),
  ]);

  return {
    total: totalRes.count ?? 0,
    enabled: enabledRes.count ?? 0,
    top8: top8Res.count ?? 0,
  };
}

async function getUser(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user: cookieUser },
  } = await supabaseAuth.auth.getUser();

  if (cookieUser) return cookieUser;

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token.length > 0) {
      const {
        data: { user: tokenUser },
      } = await supabaseAuth.auth.getUser(token);
      if (tokenUser) return tokenUser;
    }
  }
  return null;
}

function isAllowed(email?: string | null) {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}

function normalizeSymbol(value: unknown) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 20);
}

function sanitizePriority(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function sanitizeNotes(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, MAX_NOTES_LENGTH);
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function clampNumber(value: string | null, min: number, max: number, fallback: number) {
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}
