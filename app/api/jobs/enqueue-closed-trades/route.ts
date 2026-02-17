import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { requireJobAuth } from '@/lib/jobs/auth'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LiveTradeRow = {
  id: string
  ticker: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  exit_reason: string | null
  realized_pnl_dollars: number | null
  exit_timestamp: string | null
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const computeReturnPct = (t: Pick<LiveTradeRow, 'entry_price' | 'exit_price' | 'side'>): number | null => {
  const entry = t.entry_price
  const exit = t.exit_price
  if (!isFiniteNum(entry) || entry <= 0) return null
  if (!isFiniteNum(exit)) return null
  const side = (t.side ?? 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
  const raw = ((exit - entry) / entry) * 100
  return side === 'SHORT' ? -raw : raw
}

export async function POST(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  if (process.env.DISCORD_POST_TRADES_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'disabled' })
  }

  const logger = new JobLogger('enqueue_closed_trades')
  await logger.start()

  try {
    // Look back a safe window; dedupe is enforced by DB unique index (channel, payload.trade_id)
    const sinceIso = DateTime.utc().minus({ days: 7 }).toISO()!

    const { data, error } = await supabaseAdmin
      .from('live_trades')
      .select('id,ticker,side,entry_price,exit_price,exit_reason,realized_pnl_dollars,exit_timestamp')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING')
      .not('exit_timestamp', 'is', null)
      .gte('exit_timestamp', sinceIso)
      .order('exit_timestamp', { ascending: false })
      .limit(500)

    if (error) {
      await logger.finish(false, {}, error.message)
      return NextResponse.json({ error: 'Failed to load closed trades' }, { status: 500 })
    }

    const rows = (data ?? []) as LiveTradeRow[]
    let enqueued = 0
    let skipped = 0

    for (const t of rows) {
      const payload = {
        trade_id: t.id,
        ticker: (t.ticker ?? '').toUpperCase() || 'UNKNOWN',
        side: ((t.side ?? 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        realized_pnl_dollars: t.realized_pnl_dollars,
        return_pct: computeReturnPct(t),
        exit_reason: t.exit_reason,
        exit_timestamp: t.exit_timestamp,
        footer: 'Full ledger: https://www.marild.com/trust',
      }

      const { error: insertError } = await supabaseAdmin.from('outbound_posts').insert({
        report_id: null,
        channel: 'discord_trades',
        status: 'pending',
        payload,
        attempt_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      if (insertError) {
        // Unique conflict = already enqueued; ignore.
        if (String((insertError as any).code) === '23505') {
          skipped += 1
          continue
        }
        console.warn('[enqueue-closed-trades] insert failed', insertError)
        skipped += 1
        continue
      }

      enqueued += 1
    }

    await logger.finish(true, { scanned: rows.length, enqueued, skipped })
    return NextResponse.json({ ok: true, scanned: rows.length, enqueued, skipped })
  } catch (err) {
    await logger.finish(false, {}, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
