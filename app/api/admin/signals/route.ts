import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  engine: z.string().trim().min(1).optional(),
  timeframe: z.string().trim().min(1).optional(),
  min_confidence: z.coerce.number().min(0).max(100).optional(),
  days: z.coerce.number().int().min(1).max(30).default(7),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(40),
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

  const { engine, timeframe, min_confidence, days, page, page_size } = parsed.data;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  try {
    let qb = supabase
      .from('ai_signals')
      .select(
        [
          'id',
          'symbol',
          'timeframe',
          'signal_type',
          'status',
          'confidence_score',
          'correction_risk',
          'volatility_state',
          'volatility_percentile',
          'volatility_explanation',
          'entry_price',
          'stop_loss',
          'take_profit_1',
          'signal_bar_ts',
          'created_at',
          'updated_at',
          'is_manual_request',
          'source',
          'engine_type',
          'engine_version',
          'engine_key',
          'visibility_state',
          'discord_sent_at',
          'discord_channel',
          'discord_daily_rank',
          'discord_delivery_status',
          'discord_skip_reason',
          'discord_error',
          'trade_gate_allowed',
          'trade_gate_reason',
          'blocked_until_et',
          'performance_trade_id',
          'performance_traded',
          'performance_trade_status',
        ].join(', '),
        { count: 'exact' },
      )
      .gte('updated_at', since);

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
      id: row.id ?? null,
      symbol: row.symbol ?? null,
      signal_type: row.signal_type ?? null,
      status: row.status ?? null,
      confidence_score: row.confidence_score ?? null,
      correction_risk: row.correction_risk ?? null,
      entry_price: row.entry_price ?? null,
      stop_loss: row.stop_loss ?? null,
      take_profit_1: row.take_profit_1 ?? null,
      signal_bar_ts: row.signal_bar_ts ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      is_manual_request: row.is_manual_request ?? null,
      source: row.source ?? null,
      engine_type: row.engine_type ?? null,
      engine_version: row.engine_version ?? null,
      engine_key: row.engine_key ?? null,
      visibility_state: row.visibility_state ?? null,
      discord_sent_at: row.discord_sent_at ?? null,
      discord_channel: row.discord_channel ?? null,
      discord_daily_rank: row.discord_daily_rank ?? null,
      discord_delivery_status: row.discord_delivery_status ?? null,
      discord_skip_reason: row.discord_skip_reason ?? null,
      discord_error: row.discord_error ?? null,
      trade_gate_allowed: row.trade_gate_allowed ?? null,
      trade_gate_reason: row.trade_gate_reason ?? null,
      blocked_until_et: row.blocked_until_et ?? null,
      performance_trade_id: row.performance_trade_id ?? null,
      performance_traded: row.performance_traded ?? null,
      performance_trade_status: row.performance_trade_status ?? null,
      volatility_state: row.volatility_state ?? null,
      volatility_percentile: row.volatility_percentile ?? null,
      volatility_explanation: row.volatility_explanation ?? null,
    }));

    return NextResponse.json(
      {
        items,
        page,
        page_size,
        total: count ?? 0,
        days,
        since,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[admin/signals] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
