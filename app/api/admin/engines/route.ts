import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

  // Backwards compatibility:
  // - Legacy admin expects an array of engine_versions.
  // - Admin v2 UI sends x-admin-v2: 1 and expects { items: [...] } with computed metrics.
  const wantsV2 = (request.headers.get('x-admin-v2') || '').trim() === '1';

  if (wantsV2) {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';

    try {
      const resp = await fetch(`${request.nextUrl.origin}/api/admin/engine-metrics`, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return NextResponse.json({ error: json?.error ?? 'Failed to load engines' }, { status: resp.status });
      }

      const items = Array.isArray((json as any)?.metrics) ? (json as any).metrics : [];

      return NextResponse.json(
        {
          items: items.map((m: any) => ({
            id: m.id ?? null,
            engine_key: m.engine_key ?? null,
            engine_version: m.engine_version ?? null,
            run_mode: m.run_mode ?? null,
            is_enabled: m.is_enabled ?? null,
            status: m.is_enabled === false ? 'paused' : 'running',
            trades: m.total_trades ?? null,
            win_rate: m.win_rate ?? null,
            net_return: m.net_return ?? null,
            max_drawdown: m.max_drawdown ?? null,
            current_equity: m.current_equity ?? null,
            display_label: m.display_label ?? null,
          })),
        },
        { status: 200 },
      );
    } catch (err) {
      console.error('[admin/engines] v2 unexpected error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('engine_versions')
    .select('id,version,created_at,notes,features,metrics,improvement_score')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to load engines' }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}
