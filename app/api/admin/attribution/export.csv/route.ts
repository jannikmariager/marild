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

export async function GET(request: NextRequest) {
  try {
    try {
      requireAdminKey(request);
    } catch (err) {
      return new NextResponse((err as Error).message, { status: 401 });
    }

    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profile')
      .select('user_id, email, created_at, plan, referrer, landing_path, utm_source, utm_medium');

    if (usersError) {
      console.error('[admin/attribution/export.csv] usersError', usersError);
      return new NextResponse('Failed to load users', { status: 500 });
    }

    const { data: attributions, error: attrError } = await supabaseAdmin
      .from('user_attributions')
      .select('user_id, source, details, created_at');

    if (attrError) {
      console.error('[admin/attribution/export.csv] attrError', attrError);
      return new NextResponse('Failed to load attributions', { status: 500 });
    }

    const attributionByUser = new Map<string, any>();
    for (const row of attributions ?? []) {
      attributionByUser.set(row.user_id, row);
    }

    const header = [
      'user_id',
      'email',
      'created_at',
      'plan',
      'attribution_source',
      'attribution_detail',
      'captured_at',
      'referrer',
      'landing_path',
      'utm_source',
      'utm_medium',
    ];

    const lines: string[] = [];
    lines.push(header.join(','));

    for (const u of users ?? []) {
      const a = attributionByUser.get(u.user_id) ?? null;
      const row = [
        u.user_id,
        u.email,
        u.created_at,
        (u as any).plan ?? '',
        a?.source ?? '',
        a?.details ? String(a.details).replace(/"/g, '""') : '',
        a?.created_at ?? '',
        (u as any).referrer ?? '',
        (u as any).landing_path ?? '',
        (u as any).utm_source ?? '',
        (u as any).utm_medium ?? '',
      ];
      lines.push(row.map((v) => (v != null ? String(v) : '')).join(','));
    }

    const csv = lines.join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="attribution_export.csv"',
      },
    });
  } catch (err) {
    console.error('[admin/attribution/export.csv] unexpected', err);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
