import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdminKey(request: NextRequest) {
  const expected = process.env.ADMIN_CRON_KEY;
  if (!expected) throw new Error('ADMIN_CRON_KEY not configured');

  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const queryToken = request.nextUrl.searchParams.get('token');
  const supplied = bearer || queryToken;

  if (!supplied || supplied !== expected) {
    throw new Error('Unauthorized');
  }
}

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function GET(request: NextRequest) {
  try {
    try {
      requireAdminKey(request);
    } catch (err) {
      return json({ error: (err as Error).message }, { status: 401 });
    }

    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10)));
    const source = url.searchParams.get('source') || undefined;
    const search = url.searchParams.get('search') || undefined;

    // We expect a denormalized view or join. For now, query auth.users and left join attribution via RPC.
    // Simple approach: fetch users and attribution separately and join in memory.

    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, email, created_at, plan');

    if (usersError) {
      console.error('[admin/attribution/users] usersError', usersError);
      return json({ error: 'Failed to load users' }, { status: 500 });
    }

    const { data: attributions, error: attrError } = await supabaseAdmin
      .from('user_attributions')
      .select('user_id, source, details, created_at');

    if (attrError) {
      console.error('[admin/attribution/users] attrError', attrError);
      return json({ error: 'Failed to load attributions' }, { status: 500 });
    }

    const attributionByUser = new Map<string, any>();
    for (const row of attributions ?? []) {
      attributionByUser.set(row.user_id, row);
    }

    let rows = (users ?? []).map((u) => {
      const a = attributionByUser.get(u.user_id) ?? null;
      return {
        user_id: u.user_id,
        email: u.email,
        created_at: u.created_at,
        plan: (u as any).plan ?? null,
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
