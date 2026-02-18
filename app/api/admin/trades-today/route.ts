import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function startOfTodayUtc(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function endOfTodayUtc(): string {
  const d = new Date()
  d.setUTCHours(23, 59, 59, 999)
  return d.toISOString()
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request)
  if (ctx instanceof NextResponse) return ctx

  let supabase
  try {
    supabase = getAdminSupabaseOrThrow() as any
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const start = startOfTodayUtc()
  const end = endOfTodayUtc()

  try {
    const liveQ = supabase
      .from('live_trades')
      .select(
        'engine_key, engine_version, realized_pnl_dollars, exit_timestamp',
      )
      .not('exit_timestamp', 'is', null)
      .gte('exit_timestamp', start)
      .lte('exit_timestamp', end)

    const shadowQ = supabase
      .from('engine_trades')
      .select('engine_key, engine_version, realized_pnl, closed_at, run_mode')
      .eq('run_mode', 'SHADOW')
      .not('closed_at', 'is', null)
      .gte('closed_at', start)
      .lte('closed_at', end)

    const [{ data: liveRows, error: liveError }, { data: shadowRows, error: shadowError }] = await Promise.all([
      liveQ,
      shadowQ,
    ])

    if (liveError) {
      console.error('[admin/trades-today] live error', liveError)
    }
    if (shadowError) {
      console.error('[admin/trades-today] shadow error', shadowError)
    }

    const liveAgg: Record<
      string,
      { engine_key: string | null; engine_version: string | null; trades: number; pnl: number }
    > = {}
    for (const row of (liveRows ?? []) as Array<{
      engine_key: string | null
      engine_version: string | null
      realized_pnl_dollars: number | null
    }>) {
      const key = `${row.engine_key ?? ''}::${row.engine_version ?? ''}`
      if (!liveAgg[key]) {
        liveAgg[key] = {
          engine_key: row.engine_key ?? null,
          engine_version: row.engine_version ?? null,
          trades: 0,
          pnl: 0,
        }
      }
      liveAgg[key].trades += 1
      const v = typeof row.realized_pnl_dollars === 'number' ? row.realized_pnl_dollars : 0
      if (Number.isFinite(v)) liveAgg[key].pnl += v
    }

    const shadowAgg: Record<
      string,
      { engine_key: string | null; engine_version: string | null; trades: number; pnl: number }
    > = {}
    for (const row of (shadowRows ?? []) as Array<{
      engine_key: string | null
      engine_version: string | null
      realized_pnl: number | null
    }>) {
      const key = `${row.engine_key ?? ''}::${row.engine_version ?? ''}`
      if (!shadowAgg[key]) {
        shadowAgg[key] = {
          engine_key: row.engine_key ?? null,
          engine_version: row.engine_version ?? null,
          trades: 0,
          pnl: 0,
        }
      }
      const v = typeof row.realized_pnl === 'number' ? row.realized_pnl : 0
      if (Number.isFinite(v)) shadowAgg[key].pnl += v
      shadowAgg[key].trades += 1
    }

    return NextResponse.json(
      {
        start,
        end,
        live: Object.values(liveAgg),
        shadow: Object.values(shadowAgg),
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[admin/trades-today] unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
