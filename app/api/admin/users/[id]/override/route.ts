import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, getAdminSupabaseOrThrow, logAdminAction } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z
  .object({
    subscription_tier: z.string().trim().min(1).optional(),
    premium_override_dev: z.boolean().optional(),
    trial_ends_at: z.string().datetime().nullable().optional(),
    role: z.enum(['user', 'admin']).optional(),
  })
  .strict();

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const bodyJson = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { data: before, error: beforeError } = await supabase
      .from('user_profile')
      .select('user_id, email, subscription_tier, premium_override_dev, role, updated_at')
      .eq('user_id', id)
      .maybeSingle();

    if (beforeError) {
      return NextResponse.json({ error: 'Failed to load user' }, { status: 500 });
    }

    const patch: Record<string, any> = { ...parsed.data, updated_at: new Date().toISOString() };

    const { data: after, error: updateError } = await supabase
      .from('user_profile')
      .update(patch)
      .eq('user_id', id)
      .select('user_id, email, subscription_tier, premium_override_dev, role, updated_at')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }

    void logAdminAction({
      adminId: adminCtx.adminId,
      action: 'users.override',
      entity: `user_profile:${id}`,
      before,
      after,
    });

    return NextResponse.json({ user: after ?? null }, { status: 200 });
  } catch (err) {
    console.error('[admin/users/:id/override] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
