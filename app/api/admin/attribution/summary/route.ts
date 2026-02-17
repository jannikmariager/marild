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

// range query param: 7d | 30d | 90d | all
function getSince(range: string | null): Date | null {
  if (!range || range === 'all') return null;
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  if (!days) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function GET(request: NextRequest) {
  try {
    try {
      requireAdminKey(request);
    } catch (err) {
      return json({ error: (err as Error).message }, { status: 401 });
    }

    const range = request.nextUrl.searchParams.get('range');
    const since = getSince(range);

    // We approximate "unknown" as users without a row in user_attributions.
    // For time filtering we use created_at on user_attributions when available.

    const { data: bySource, error: sourceError } = await supabaseAdmin
      .from('user_attributions')
      .select('source, created_at');

    if (sourceError) {
      console.error('[admin/attribution/summary] sourceError', sourceError);
      return json({ error: 'Failed to load attribution data' }, { status: 500 });
    }

    const filtered = since
      ? (bySource ?? []).filter((row) => new Date(row.created_at).getTime() >= since.getTime())
      : bySource ?? [];

    const totalResponses = filtered.length;

    const counts: Record<string, number> = {};
    for (const row of filtered) {
      const key = row.source ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const by_source = Object.entries(counts)
      .map(([source, count]) => ({ source, count, pct: totalResponses ? (count / totalResponses) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);

    const top = by_source[0];

    const totals = {
      responses: totalResponses,
      unknown: counts['unknown'] ?? 0,
      unknown_pct: totalResponses ? ((counts['unknown'] ?? 0) / totalResponses) * 100 : 0,
      top_source: top?.source ?? null,
    };

    return json({ totals, by_source });
  } catch (err) {
    console.error('[admin/attribution/summary] unexpected', err);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
