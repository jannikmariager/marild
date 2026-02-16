import { NextRequest, NextResponse } from 'next/server';
import { getEngineStyleLabel } from '@/lib/engineStyles';
import { requireAdmin, getAdminSupabaseOrThrow, logAdminAction } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FLAG_ENABLED_KEY = 'engine_allocation_enabled';
const FLAG_ALLOWLIST_KEY = 'engine_allocation_symbol_allowlist';

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  // Flags
  const { data: flagsData, error: flagsError } = await supabase
    .from('app_feature_flags')
    .select('key, bool_value, text_array_value')
    .in('key', [FLAG_ENABLED_KEY, FLAG_ALLOWLIST_KEY]);
  if (flagsError) return NextResponse.json({ error: 'Failed to load flags' }, { status: 500 });

  const enabled = Boolean(flagsData?.find((f) => f.key === FLAG_ENABLED_KEY)?.bool_value);
  const allowlist = (flagsData?.find((f) => f.key === FLAG_ALLOWLIST_KEY)?.text_array_value as string[]) || [];

  // Owners (limit for UI)
  const { data: owners, error: ownersError } = await supabase
    .from('ticker_engine_owner')
    .select('symbol, active_engine_key, active_engine_version, locked_until, last_promotion_at, updated_at, last_score')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (ownersError) return NextResponse.json({ error: 'Failed to load owners' }, { status: 500 });
  let comparisons: Record<string, any[]> = {};
  const ownerSymbols = (owners || []).map((o) => o.symbol);
  if (ownerSymbols.length > 0) {
    const { data: scoreRows, error: scoresError } = await supabase
      .from('engine_ticker_score_history')
      .select('symbol, engine_key, engine_version, score, expectancy_r, max_dd_r, trades')
      .eq('window_days', 60)
      .in('symbol', ownerSymbols)
      .order('score', { ascending: false })
      .limit(ownerSymbols.length * 5);
    if (!scoresError && scoreRows) {
      const grouped = new Map<string, any[]>();
      for (const row of scoreRows) {
        const list = grouped.get(row.symbol) ?? [];
        if (list.length >= 3) continue;
        list.push({
          engine_key: row.engine_key,
          engine_version: row.engine_version,
          score: Number(row.score ?? 0),
          expectancy_r: Number(row.expectancy_r ?? 0),
          max_dd_r: Number(row.max_dd_r ?? 0),
          trades: Number(row.trades ?? 0),
          style: getEngineStyleLabel(row.engine_key, 'SWING'),
        });
        grouped.set(row.symbol, list);
      }
      comparisons = Object.fromEntries(grouped);
    }
  }

  // Promotion log (recent)
  const { data: promotions, error: promoError } = await supabase
    .from('promotion_log')
    .select('ts, symbol, from_engine_key, to_engine_key, from_version, to_version, delta, applied, reason, pending_reason, decision_mode, locked_until')
    .order('ts', { ascending: false })
    .limit(100);
  if (promoError) return NextResponse.json({ error: 'Failed to load promotion log' }, { status: 500 });

  return NextResponse.json({
    enabled,
    allowlist,
    owners: owners || [],
    promotions: promotions || [],
    comparisons,
  });
}

export async function POST(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const body = await request.json();
  const action = body?.action;

  if (action === 'update_flags') {
    const enabled = Boolean(body.enabled);
    const allowlist: string[] = Array.isArray(body.allowlist)
      ? body.allowlist.map((s: string) => s.trim().toUpperCase()).filter(Boolean)
      : [];

    const updates = [
      { key: FLAG_ENABLED_KEY, bool_value: enabled, text_array_value: null },
      { key: FLAG_ALLOWLIST_KEY, bool_value: null, text_array_value: allowlist },
    ];

    const { error } = await supabase.from('app_feature_flags').upsert(updates, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: 'Failed to update flags' }, { status: 500 });

    void logAdminAction({
      adminId: adminCtx.adminId,
      action: 'engine_allocation.update_flags',
      entity: 'app_feature_flags',
      before: null,
      after: { enabled, allowlist },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'set_owner') {
    const symbol: string = (body.symbol || '').trim().toUpperCase();
    const engine_key: string = (body.engine_key || 'SWING').trim().toUpperCase();
    const engine_version: string = (body.engine_version || 'BASELINE').trim();
    const lock_days: number = Number(body.lock_days ?? 45);
    if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

    const lockUntil = new Date(Date.now() + lock_days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('ticker_engine_owner').upsert({
      symbol,
      active_engine_key: engine_key,
      active_engine_version: engine_version,
      locked_until: lockUntil,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: 'Failed to upsert owner' }, { status: 500 });

    void logAdminAction({
      adminId: adminCtx.adminId,
      action: 'engine_allocation.set_owner',
      entity: `ticker_engine_owner:${symbol}`,
      before: null,
      after: { symbol, engine_key, engine_version, lock_days },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'lock_owner') {
    const symbol: string = (body.symbol || '').trim().toUpperCase();
    const lock_days: number = Number(body.lock_days ?? 30);
    if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    const lockUntil = new Date(Date.now() + lock_days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('ticker_engine_owner').upsert({
      symbol,
      locked_until: lockUntil,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: 'Failed to lock owner' }, { status: 500 });

    void logAdminAction({
      adminId: adminCtx.adminId,
      action: 'engine_allocation.lock_owner',
      entity: `ticker_engine_owner:${symbol}`,
      before: null,
      after: { symbol, lock_days },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === 'revert_owner') {
    const symbol: string = (body.symbol || '').trim().toUpperCase();
    if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    const lockUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('ticker_engine_owner').upsert({
      symbol,
      active_engine_key: 'SWING',
      active_engine_version: 'BASELINE',
      last_score: null,
      locked_until: lockUntil,
      last_promotion_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: 'Failed to revert owner' }, { status: 500 });

    void logAdminAction({
      adminId: adminCtx.adminId,
      action: 'engine_allocation.revert_owner',
      entity: `ticker_engine_owner:${symbol}`,
      before: null,
      after: { symbol },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
