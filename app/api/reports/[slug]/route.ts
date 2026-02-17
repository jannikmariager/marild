import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cacheHeaders = (res: NextResponse) => {
  res.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  return res
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })

  const { data, error } = await supabase
    .from('weekly_execution_reports')
    .select(
      'slug,week_start,week_end,net_pnl_usd,net_return_pct,win_rate_pct,profit_factor,max_drawdown_pct,closed_trades,winners,losers,avg_hold_hours,equity_at_week_start,equity_at_week_end,largest_win_usd,largest_loss_usd,report_markdown,excerpt',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to load report' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = {
    slug: data.slug,
    week_start: data.week_start,
    week_end: data.week_end,
    net_pnl_usd: data.net_pnl_usd,
    net_return_pct: data.net_return_pct,
    win_rate_pct: data.win_rate_pct,
    profit_factor: data.profit_factor,
    max_drawdown_pct: data.max_drawdown_pct,
    closed_trades: data.closed_trades,
    winners: data.winners,
    losers: data.losers,
    avg_hold_hours: data.avg_hold_hours,
    equity_at_week_start: data.equity_at_week_start,
    equity_at_week_end: data.equity_at_week_end,
    largest_win_usd: data.largest_win_usd,
    largest_loss_usd: data.largest_loss_usd,
    report_markdown: data.report_markdown,
    excerpt: data.excerpt,
  }

  return cacheHeaders(NextResponse.json(body))
}
