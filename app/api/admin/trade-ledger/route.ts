import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  ticker: z.string().trim().min(1).optional(),
  start_date: z.string().trim().optional(), // YYYY-MM-DD
  end_date: z.string().trim().optional(),
  status: z.string().trim().optional(), // win|loss|any
  engine: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const isDateKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

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

  const { ticker, start_date, end_date, status, engine, page, page_size } = parsed.data;
  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  try {
    let qb = supabase
      .from('live_trades')
      .select(
        'ticker, side, entry_price, exit_price, realized_pnl_dollars, exit_reason, engine_key, engine_version, exit_timestamp, entry_timestamp',
        { count: 'exact' },
      )
      .not('exit_timestamp', 'is', null);

    if (ticker) {
      qb = qb.eq('ticker', ticker.toUpperCase());
    }

    if (engine) {
      // Best-effort: live_trades appears to have engine_version in existing code.
      qb = qb.eq('engine_version', engine);
    }

    if (status) {
      const s = status.toLowerCase();
      if (s === 'win') qb = qb.gt('realized_pnl_dollars', 0);
      if (s === 'loss') qb = qb.lt('realized_pnl_dollars', 0);
    }

    if (start_date && isDateKey(start_date)) {
      qb = qb.gte('exit_timestamp', `${start_date}T00:00:00.000Z`);
    }
    if (end_date && isDateKey(end_date)) {
      qb = qb.lte('exit_timestamp', `${end_date}T23:59:59.999Z`);
    }

    const { data, error, count } = await qb
      .order('exit_timestamp', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[admin/trade-ledger] query error', error);
      return NextResponse.json({ error: 'Failed to load trade ledger' }, { status: 500 });
    }

    const items = (data ?? []).map((row: any) => {
      const side = (row.side || 'LONG') as 'LONG' | 'SHORT';
      const entry = Number(row.entry_price ?? 0);
      const exit = row.exit_price == null ? null : Number(row.exit_price);
      let pnl_pct: number | null = null;
      if (exit != null && Number.isFinite(exit) && Number.isFinite(entry) && entry > 0) {
        const raw = side === 'SHORT' ? ((entry - exit) / entry) * 100 : ((exit - entry) / entry) * 100;
        pnl_pct = Math.round(raw * 100) / 100;
      }

      return {
        symbol: row.ticker ?? null,
        direction: side,
        entry: row.entry_price ?? null,
        exit: row.exit_price ?? null,
        pnl_pct,
        pnl_usd: row.realized_pnl_dollars ?? null,
        status: row.exit_reason ?? null,
        engine: row.engine_version ?? row.engine_key ?? null,
        closed_at: row.exit_timestamp ?? null,
      };
    });

    return NextResponse.json({ items, page, page_size, total: count ?? 0 }, { status: 200 });
  } catch (err) {
    console.error('[admin/trade-ledger] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
