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

interface RouteContext {
  params: { id: string };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    try {
      requireAdminKey(request);
    } catch (err) {
      return json({ error: (err as Error).message }, { status: 401 });
    }

    const userId = context.params.id;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, email, created_at, plan, referrer, landing_path, utm_source, utm_medium')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[admin/attribution/users/:id] profileError', profileError);
      return json({ error: 'Failed to load user' }, { status: 500 });
    }

    if (!profile) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const { data: attribution, error: attrError } = await supabaseAdmin
      .from('user_attributions')
      .select('source, details, created_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (attrError) {
      console.error('[admin/attribution/users/:id] attrError', attrError);
    }

    return json({
      user_id: profile.user_id,
      email: profile.email,
      created_at: profile.created_at,
      plan: (profile as any).plan ?? null,
      attribution_source: attribution?.source ?? undefined,
      attribution_detail: attribution?.details ?? undefined,
      captured_at: attribution?.created_at ?? undefined,
      referrer: (profile as any).referrer ?? null,
      landing_path: (profile as any).landing_path ?? null,
      utm_source: (profile as any).utm_source ?? null,
      utm_medium: (profile as any).utm_medium ?? null,
    });
  } catch (err) {
    console.error('[admin/attribution/users/:id] unexpected', err);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
