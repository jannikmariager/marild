import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  query: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 });
  }

  const { query, page, page_size } = parsed.data;
  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  // Summary fields that are not currently backed by verified tables are returned as null.
  const summary: Record<string, any> = {
    total_users: null,
    active_pro: null,
    trials: null,
    churn_30d: null,
    revenue_today: null,
  };

  try {
    // total_users
    const { count: totalCount } = await supabase.from('user_profile').select('user_id', { count: 'exact', head: true });
    summary.total_users = totalCount ?? 0;

    // active_pro
    const { data: allUsers, error } = await supabase
      .from('user_profile')
      .select('subscription_tier, premium_override_dev');
    if (!error) {
      summary.active_pro = (allUsers ?? []).filter(
        (u: any) => u?.subscription_tier === 'pro' || u?.premium_override_dev === true,
      ).length;
    }
  } catch {
    // keep nulls
  }

  try {
    let qb = supabase
      .from('user_profile')
      .select('user_id, email, subscription_tier, premium_override_dev, role, created_at, updated_at, display_name', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (query && query.length > 0) {
      // Best-effort: ilike on email and display_name.
      qb = qb.or(`email.ilike.%${query}%,display_name.ilike.%${query}%`);
    }

    const { data, error, count } = await qb.range(from, to);

    if (error) {
      return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
    }

    return NextResponse.json(
      {
        summary,
        items: data ?? [],
        page,
        page_size,
        total: count ?? 0,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[admin/users] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
