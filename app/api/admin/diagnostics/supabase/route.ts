import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function requireAdminKey(request: NextRequest) {
  const expected = process.env.ADMIN_CRON_KEY
  if (!expected) throw new Error('ADMIN_CRON_KEY not configured')

  const header = request.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const queryToken = request.nextUrl.searchParams.get('token')
  const supplied = bearer || queryToken

  if (!supplied || supplied !== expected) {
    throw new Error('Unauthorized')
  }
}

const looksMissingTable = (message: string | undefined | null) => {
  const m = (message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('42p01')
}

export async function GET(request: NextRequest) {
  try {
    requireAdminKey(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  // 1) Check tables exist via service role selects
  const weekly = await supabaseAdmin.from('weekly_execution_reports').select('id').limit(1)
  const outbound = await supabaseAdmin.from('outbound_posts').select('id').limit(1)

  const weeklyExists = !weekly.error
  const outboundExists = !outbound.error

  // 2) Check public select works for weekly_execution_reports via anon key
  let canSelectWeeklyReportsPublicly = false
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (supabaseUrl && anonKey) {
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    const res = await anon.from('weekly_execution_reports').select('slug').limit(1)
    canSelectWeeklyReportsPublicly = !res.error
  }

  const details = {
    weekly_execution_reports: weekly.error ? { ok: false, error: weekly.error.message } : { ok: true },
    outbound_posts: outbound.error ? { ok: false, error: outbound.error.message } : { ok: true },
  }

  const tablesExist = weeklyExists && outboundExists

  // Heuristic: missing migration if either table missing
  const migrationLikelyMissing =
    (!weeklyExists && looksMissingTable(weekly.error?.message)) ||
    (!outboundExists && looksMissingTable(outbound.error?.message))

  return NextResponse.json({
    tablesExist,
    migrationLikelyMissing,
    canSelectWeeklyReportsPublicly,
    details,
  })
}
