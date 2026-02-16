import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request)
  if (adminCtx instanceof NextResponse) return adminCtx

  let supabase
  try {
    supabase = getAdminSupabaseOrThrow()
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const engineKey = searchParams.get('engine_key') || 'SWING'
    const engineVersion = searchParams.get('engine_version')
    const tradingDay = searchParams.get('trading_day') // optional override (YYYY-MM-DD)

    if (!engineVersion) {
      return NextResponse.json({ error: 'engine_version is required' }, { status: 400 })
    }

    // Determine trading day in America/New_York when not provided
    let dayKey = tradingDay
    if (!dayKey) {
      const now = new Date()
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      dayKey = formatter.format(now)
    }

    const { data, error } = await supabase
      .from('engine_daily_state')
      .select('*')
      .eq('engine_key', engineKey)
      .eq('engine_version', engineVersion)
      .eq('trading_day', dayKey)
      .maybeSingle()

    if (error) {
      console.error('[engine-daily-state] Error fetching state:', error)
      return NextResponse.json({ error: 'Failed to fetch state' }, { status: 500 })
    }

    return NextResponse.json({ state: data ?? null }, { status: 200 })
  } catch (err) {
    console.error('[engine-daily-state] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}