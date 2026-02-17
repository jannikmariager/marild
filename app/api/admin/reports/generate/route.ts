import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { generateWeeklyExecutionReport } from '@/lib/reports/weekly/generate'
import { nyWeekBoundsFromWeekEnd, REPORT_TZ } from '@/lib/reports/weekly/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const isDateKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

function requireAdminKey(request: NextRequest) {
  const expected = process.env.ADMIN_CRON_KEY
  if (!expected) {
    throw new Error('ADMIN_CRON_KEY not configured')
  }

  const header = request.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const queryToken = request.nextUrl.searchParams.get('token')
  const supplied = bearer || queryToken

  if (!supplied || supplied !== expected) {
    throw new Error('Unauthorized')
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAdminKey(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const weekEnd = String(searchParams.get('weekEnd') ?? '').trim()
  const force = searchParams.get('force') === '1'

  if (!isDateKey(weekEnd)) {
    return NextResponse.json({ error: 'Invalid weekEnd (expected YYYY-MM-DD)' }, { status: 400 })
  }

  // Safety: ensure weekEnd is a Friday in NY time.
  const dt = DateTime.fromISO(weekEnd, { zone: REPORT_TZ })
  if (dt.weekday !== 5) {
    return NextResponse.json({ error: 'weekEnd must be a Friday (ET)' }, { status: 400 })
  }

  const { weekStartNyKey, weekEndNyKey } = nyWeekBoundsFromWeekEnd(weekEnd)

  try {
    const res = await generateWeeklyExecutionReport({ weekStartNyKey, weekEndNyKey, force })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
