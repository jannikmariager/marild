import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  engine: z.string().trim().min(1).optional(),
  timeframe: z.string().trim().min(1).optional(),
  min_confidence: z.coerce.number().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 });
  }

  const { engine, timeframe, min_confidence, page, page_size } = parsed.data;

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  try {
    let qb = supabase
      .from('ai_signals')
      .select(
        'id, symbol, timeframe, engine_type, signal_type, confidence_score, created_at',
        { count: 'exact' },
      );

    if (timeframe) {
      qb = qb.eq('timeframe', timeframe);
    }

    // engine filter: best-effort against engine_type. If schema differs, results may be empty.
    if (engine) {
      qb = qb.eq('engine_type', engine);
    }

    if (typeof min_confidence === 'number') {
      qb = qb.gte('confidence_score', min_confidence);
    }

    const { data, error, count } = await qb
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: 'Failed to load signals' }, { status: 500 });
    }

    const items = (data ?? []).map((row: any) => ({
      symbol: row.symbol ?? null,
      direction: null, // Unknown until ai_signals schema is confirmed
      confidence: row.confidence_score ?? null,
      generated_at: row.created_at ?? null,
      status: null, // Unknown until ai_signals schema is confirmed
      engine: row.engine_type ?? null,
      timeframe: row.timeframe ?? null,
    }));

    return NextResponse.json(
      {
        items,
        page,
        page_size,
        total: count ?? 0,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[admin/signals] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
