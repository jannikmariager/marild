import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseOrThrow, requireAdmin } from '@/app/api/_lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

// Narrowed shapes for attribution admin list.
type UserProfileRow = {
  user_id: string;
  email: string;
  created_at: string;
  plan?: string | null;
};

type AttributionRow = {
  user_id: string;
  source: string | null;
  details: string | null;
  created_at: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const adminCtx = await requireAdmin(request);
    if (adminCtx instanceof NextResponse) return adminCtx;

    const supabaseAdmin = getAdminSupabaseOrThrow();

    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10)));
    const source = url.searchParams.get('source') || undefined;
    const search = url.searchParams.get('search') || undefined;

    // We expect a denormalized view or join. For now, query auth.users and left join attribution via RPC.
    // Simple approach: fetch users and attribution separately and join in memory.

    const { data: usersRaw, error: usersError } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, email, created_at, plan');

    if (usersError) {
      console.error('[admin/attribution/users] usersError', usersError);
      return json({ error: 'Failed to load users' }, { status: 500 });
    }

    const users = (usersRaw ?? []) as UserProfileRow[];

    const { data: attributionsRaw, error: attrError } = await supabaseAdmin
      .from('user_attributions')
      .select('user_id, source, details, created_at');

    if (attrError) {
      console.error('[admin/attribution/users] attrError', attrError);
      return json({ error: 'Failed to load attributions' }, { status: 500 });
    }

    const attributions = (attributionsRaw ?? []) as AttributionRow[];

    const attributionByUser = new Map<string, AttributionRow>();
    for (const row of attributions) {
      attributionByUser.set(row.user_id, row);
    }

    let rows = users.map((u) => {
      const a = attributionByUser.get(u.user_id) ?? null;
      return {
        user_id: u.user_id,
        email: u.email,
        created_at: u.created_at,
        plan: u.plan ?? null,
        attribution_source: a?.source ?? undefined,
        attribution_detail: a?.details ?? undefined,
        captured_at: a?.created_at ?? undefined,
      };
    });

    if (source) {
      rows = rows.filter((r) => r.attribution_source === source);
    }

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.email?.toLowerCase().includes(q));
    }

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const pageRows = rows.slice(start, end);

    return json({ rows: pageRows, page, pageSize, total });
  } catch (err) {
    console.error('[admin/attribution/users] unexpected', err);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
