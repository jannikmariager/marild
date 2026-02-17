import { NextRequest, NextResponse } from 'next/server'
import { requireJobAuth } from '@/lib/jobs/auth'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { generateWeeklyExecutionReport, enqueueWeeklyDiscordPost } from '@/lib/reports/weekly/generate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  if (process.env.REPORT_AUTOGEN_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, error: 'autogen_disabled' }, { status: 403 })
  }

  const logger = new JobLogger('weekly_execution_reports')
  await logger.start()

  try {
    const res = await generateWeeklyExecutionReport()

    if (res.status === 'exists') {
      await logger.finish(true, { status: 'exists', slug: res.slug })
      return NextResponse.json({ ok: true, status: 'exists', slug: res.slug })
    }

    // Load report_json.social.discord_weekly for enqueue
    if (res.reportId) {
      const { data } = await supabaseAdmin
        .from('weekly_execution_reports')
        .select('report_json')
        .eq('id', res.reportId)
        .maybeSingle()

      const discordContent = String((data as any)?.report_json?.social?.discord_weekly ?? '').trim()
      if (discordContent) {
        await enqueueWeeklyDiscordPost({ reportId: res.reportId, slug: res.slug, discordContent }).catch((err) => {
          console.warn('[weekly-execution-reports] failed to enqueue weekly discord post', err)
        })
      }
    }

    await logger.finish(true, {
      status: 'created',
      slug: res.slug,
      closed_trades: res.closed_trades,
      net_pnl_usd: res.net_pnl_usd,
      net_return_pct: res.net_return_pct,
    })

    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    await logger.finish(false, {}, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
