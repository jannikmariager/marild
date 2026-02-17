import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseOrThrow, requireAdmin } from '@/app/api/_lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

// Narrowed shape of the user_profile row we care about.
type UserProfileRow = {
  user_id: string;
  email: string;
  created_at: string;
  plan?: string | null;
  referrer?: string | null;
  landing_path?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
};

// Shape of a user_attributions row for this route.
type AttributionRow = {
  source: string | null;
  details: string | null;
  created_at: string | null;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const adminCtx = await requireAdmin(request);
    if (adminCtx instanceof NextResponse) return adminCtx;

    const supabaseAdmin = getAdminSupabaseOrThrow();

    const { id: userId } = await context.params;

    const { data: profileRaw, error: profileError } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, email, created_at, plan, referrer, landing_path, utm_source, utm_medium')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[admin/attribution/users/:id] profileError', profileError);
      return json({ error: 'Failed to load user' }, { status: 500 });
    }

    const profile = profileRaw as UserProfileRow | null;

    if (!profile) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const { data: attributionRaw, error: attrError } = await supabaseAdmin
      .from('user_attributions')
      .select('source, details, created_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (attrError) {
      console.error('[admin/attribution/users/:id] attrError', attrError);
    }

    const attribution = attributionRaw as AttributionRow | null;

    return json({
      user_id: profile.user_id,
      email: profile.email,
      created_at: profile.created_at,
      plan: profile.plan ?? null,
      attribution_source: attribution?.source ?? undefined,
      attribution_detail: attribution?.details ?? undefined,
      captured_at: attribution?.created_at ?? undefined,
      referrer: profile.referrer ?? null,
      landing_path: profile.landing_path ?? null,
      utm_source: profile.utm_source ?? null,
      utm_medium: profile.utm_medium ?? null,
    });
  } catch (err) {
    console.error('[admin/attribution/users/:id] unexpected', err);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
