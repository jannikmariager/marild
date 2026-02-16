import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// NOTE: This is a temporary v2 endpoint. The canonical v2 path is /api/admin/engines,
// but that path already exists in legacy admin. We will migrate the UI to /api/admin/engines
// after refactoring the legacy route to enforce RBAC.

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

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

    return NextResponse.json({ source: 'engine-metrics', ...json }, { status: 200 });
  } catch (err) {
    console.error('[admin/engines-v2] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
