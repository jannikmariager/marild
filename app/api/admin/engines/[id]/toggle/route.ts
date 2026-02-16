import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, getAdminSupabaseOrThrow, logAdminAction } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  is_enabled: z.boolean(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing engine id' }, { status: 400 });

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const bodyJson = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  try {
    const { data: before, error: beforeError } = await supabase
      .from('engine_versions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (beforeError) {
      return NextResponse.json({ error: 'Failed to load engine' }, { status: 500 });
    }
    if (!before) {
      return NextResponse.json({ error: 'Engine not found' }, { status: 404 });
    }

    const patch: Record<string, any> = {
      is_enabled: parsed.data.is_enabled,
      stopped_at: parsed.data.is_enabled ? null : nowIso,
    };
    if (parsed.data.is_enabled && !before.started_at) {
      patch.started_at = nowIso;
    }

    const { data: after, error: updateError } = await supabase
      .from('engine_versions')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update engine' }, { status: 500 });
    }

    void logAdminAction({
      adminId: adminCtx.adminId,
      action: 'engines.toggle',
      entity: `engine_versions:${id}`,
      before,
      after,
    });

    return NextResponse.json({ engine: after ?? null }, { status: 200 });
  } catch (err) {
    console.error('[admin/engines/:id/toggle] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
