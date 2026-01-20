import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { requireJobAuth } from '@/lib/jobs/auth'
import { marketClock } from '@/lib/marketClock'
import { fetchLatestMinuteBars } from '@/lib/data/alpaca'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

async function handle(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const logger = new JobLogger('bars_ingest_1m')
  await logger.start()

  const now = DateTime.utc()
  if (!marketClock.shouldIngest(now)) {
    await logger.finish(true, { skipped: true }, undefined, { reason: 'outside_ingest_window' })
    return NextResponse.json({ ok: true, skipped: true })
  }

  const { data: whitelistRows, error: whitelistError } = await supabaseAdmin
    .from('ticker_whitelist')
    .select('symbol')
    .eq('is_enabled', true)

  if (whitelistError) {
    await logger.finish(false, {}, whitelistError.message)
    return NextResponse.json({ error: 'Failed to load whitelist' }, { status: 500 })
  }

  const symbols = (whitelistRows || []).map((row) => row.symbol).filter(Boolean)

  if (symbols.length === 0) {
    await logger.finish(true, { processed: 0 }, undefined, { reason: 'no_symbols' })
    return NextResponse.json({ ok: true, processed: 0 })
  }

  try {
    const latestBars = await fetchLatestMinuteBars(symbols)
    const inserts: Array<Record<string, unknown>> = []
    let staleCount = 0
    let missingCount = 0

    const maxAge = marketClock.maxDataStalenessMinutes()

    for (const symbol of symbols) {
      const bar = latestBars[symbol]
      if (!bar) {
        missingCount += 1
        continue
      }
      const ts = DateTime.fromISO(bar.t, { zone: 'utc' })
      const ageMinutes = Math.abs(now.diff(ts, 'minutes').minutes)
      if (ageMinutes > maxAge) {
        staleCount += 1
      }
      inserts.push({
        symbol,
        ts: ts.toISO(),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v ?? null,
        source: 'alpaca',
      })
    }

    for (const batch of chunk(inserts, 500)) {
      if (batch.length === 0) continue
      const { error: upsertError } = await supabaseAdmin.from('bars_1m').upsert(batch, { onConflict: 'symbol,ts' })
      if (upsertError) {
        await logger.finish(false, {}, upsertError.message)
        return NextResponse.json({ error: 'Failed to store bars' }, { status: 500 })
      }
    }

    await logger.finish(
      true,
      {
        processed: inserts.length,
        stale: staleCount,
        missing: missingCount,
      },
    )
    return NextResponse.json({ ok: true, processed: inserts.length, staleCount, missingCount })
  } catch (err) {
    await logger.finish(false, {}, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
