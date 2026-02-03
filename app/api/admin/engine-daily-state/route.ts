import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const ALLOWED_EMAILS = ['jannikmariager@gmail.com']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const engineKey = searchParams.get('engine_key') || 'SWING'
    const engineVersion = searchParams.get('engine_version')
    const tradingDay = searchParams.get('trading_day') // optional override (YYYY-MM-DD)

    if (!engineVersion) {
      return NextResponse.json({ error: 'engine_version is required' }, { status: 400 })
    }

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Simple auth: reuse same allow-list as engine-metrics
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    const { data: userResp } = await supabase.auth.getUser(token)
    const user = userResp.user
    if (!user || !ALLOWED_EMAILS.includes((user.email || '').toLowerCase())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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