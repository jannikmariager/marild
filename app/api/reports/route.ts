import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cacheHeaders = (res: NextResponse) => {
  res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  return res
}

const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(v)))

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = clampInt(Number(url.searchParams.get('page') ?? 1), 1, 10_000)
  const pageSize = clampInt(Number(url.searchParams.get('pageSize') ?? 10), 1, 50)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('weekly_execution_reports')
    .select(
      'slug,week_label,excerpt,net_pnl_usd,net_return_pct,closed_trades,win_rate_pct,profit_factor,max_drawdown_pct,published_at,week_end',
      { count: 'exact' },
    )
    .order('week_end', { ascending: false })
    .range(from, to)

  if (error) {
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 })
  }

  const res = NextResponse.json({
    page,
    pageSize,
    total: count ?? 0,
    items: data ?? [],
  })

  return cacheHeaders(res)
}
