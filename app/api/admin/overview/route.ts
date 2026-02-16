import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function todayDateKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const todayKey = todayDateKeyUtc();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Defaults: fail-closed / no guessing.
  let engine_status: any = null;
  let today_pnl: number | null = null;
  let unrealized_pnl: number | null = null;
  let active_positions: number | null = null;
  let signals_last_24h: number | null = null;
  let active_pro_users: number | null = null;
  let last_cron_run: any = null;
  let heartbeat: any = null;

  try {
    const { data: engines, error } = await supabase
      .from('engine_versions')
      .select('id, engine_key, engine_version, run_mode, is_enabled, is_user_visible, started_at, stopped_at, created_at')
      .order('created_at', { ascending: false });
    if (!error) {
      engine_status = { engines: engines ?? [] };
    }
  } catch {
    engine_status = null;
  }

  try {
    // Today realized PnL from live_trades by realized_pnl_date when available.
    const { data: rows, error } = await supabase
      .from('live_trades')
      .select('realized_pnl_dollars, realized_pnl_date')
      .eq('realized_pnl_date', todayKey);

    if (!error) {
      today_pnl = (rows ?? []).reduce((sum: number, r: any) => sum + Number(r.realized_pnl_dollars ?? 0), 0);
    }
  } catch {
    today_pnl = null;
  }

  try {
    const { data: openPositions, error } = await supabase
      .from('live_positions')
      .select('unrealized_pnl_dollars');

    if (!error) {
      active_positions = openPositions?.length ?? 0;
      unrealized_pnl = (openPositions ?? []).reduce(
        (sum: number, r: any) => sum + Number(r.unrealized_pnl_dollars ?? 0),
        0,
      );
    }
  } catch {
    active_positions = null;
    unrealized_pnl = null;
  }

  try {
    const { count, error } = await supabase
      .from('ai_signals')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since24h);

    if (!error) {
      signals_last_24h = count ?? 0;
    }
  } catch {
    signals_last_24h = null;
  }

  try {
    // "Active pro" defined as subscription_tier = 'pro' OR premium_override_dev = true.
    const { data, error } = await supabase
      .from('user_profile')
      .select('subscription_tier, premium_override_dev');

    if (!error) {
      active_pro_users = (data ?? []).filter(
        (r: any) => r?.subscription_tier === 'pro' || r?.premium_override_dev === true,
      ).length;
    }
  } catch {
    active_pro_users = null;
  }

  try {
    const { data, error } = await supabase
      .from('job_run_log')
      .select('job_name, started_at, finished_at, ok, error')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error) {
      last_cron_run = data ?? null;
    }
  } catch {
    last_cron_run = null;
  }

  // Best-effort heartbeat via edge function (do not fail request).
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const hbResp = await fetch(`${url}/functions/v1/system_heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });

      heartbeat = hbResp.ok ? await hbResp.json() : { ok: false, error: `Heartbeat HTTP ${hbResp.status}` };
    }
  } catch {
    heartbeat = null;
  }

  // Revenue: reuse existing endpoint output (currently nullable/unavailable).
  let revenue: any = { mrr: null, arr: null, active_subscriptions: null, failed_payments: null, mrr_history: [], source: 'unavailable' };
  try {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const resp = await fetch(`${request.nextUrl.origin}/api/admin/revenue`, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (resp.ok) {
      revenue = await resp.json();
    }
  } catch {
    // keep default
  }

  return NextResponse.json(
    {
      engine_status,
      today_pnl,
      unrealized_pnl,
      active_positions,
      signals_last_24h,
      active_pro_users,
      mrr: revenue?.mrr ?? null,
      last_cron_run,
      heartbeat,
      revenue_source: revenue?.source ?? null,
    },
    { status: 200 },
  );
}
