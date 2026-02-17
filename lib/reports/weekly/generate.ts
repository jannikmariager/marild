import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { computeWeeklyExecutionMetrics, previousCompletedWeekNy } from '@/lib/reports/weekly/metrics'
import { generateWeeklyReportJson } from '@/lib/reports/weekly/ai'
import { renderWeeklyReportMarkdown } from '@/lib/reports/weekly/render'

export async function generateWeeklyExecutionReport(params?: {
  weekStartNyKey?: string
  weekEndNyKey?: string
  force?: boolean
}): Promise<{
  status: 'created' | 'exists'
  slug: string
  reportId: string | null
  closed_trades: number
  net_pnl_usd: number
  net_return_pct: number
}> {
  const force = Boolean(params?.force)

  const bounds =
    params?.weekStartNyKey && params?.weekEndNyKey
      ? { weekStartNyKey: params.weekStartNyKey, weekEndNyKey: params.weekEndNyKey }
      : previousCompletedWeekNy()

  const slug = bounds.weekEndNyKey

  // idempotency
  const existing = await supabaseAdmin
    .from('weekly_execution_reports')
    .select('id,slug')
    .eq('slug', slug)
    .maybeSingle()

  if (existing.data?.id && !force) {
    return {
      status: 'exists',
      slug,
      reportId: existing.data.id,
      closed_trades: 0,
      net_pnl_usd: 0,
      net_return_pct: 0,
    }
  }

  const metrics = await computeWeeklyExecutionMetrics({
    weekStartNyKey: bounds.weekStartNyKey,
    weekEndNyKey: bounds.weekEndNyKey,
  })

  const reportJson = await generateWeeklyReportJson({ metrics, slug })
  const rendered = renderWeeklyReportMarkdown({ metrics, report: reportJson, slug })

  const insertRow = {
    slug,
    week_start: bounds.weekStartNyKey,
    week_end: bounds.weekEndNyKey,
    week_label: metrics.week_label,
    published_at: new Date().toISOString(),

    metrics_json: metrics,
    report_json: reportJson,
    report_markdown: rendered.markdown,
    excerpt: rendered.excerpt,

    net_pnl_usd: metrics.net_pnl_usd,
    net_return_pct: metrics.net_return_pct,
    closed_trades: metrics.closed_trades,
    win_rate_pct: metrics.win_rate_pct,
    profit_factor: metrics.profit_factor,
    max_drawdown_pct: metrics.max_drawdown_pct,

    updated_at: new Date().toISOString(),
  }

  // Upsert if force (by slug)
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('weekly_execution_reports')
    .upsert(insertRow as any, { onConflict: 'slug' })
    .select('id')
    .single()

  if (insertError) {
    throw new Error(`Failed to store weekly_execution_reports: ${insertError.message}`)
  }

  return {
    status: 'created',
    slug,
    reportId: inserted?.id ?? null,
    closed_trades: metrics.closed_trades,
    net_pnl_usd: metrics.net_pnl_usd,
    net_return_pct: metrics.net_return_pct,
  }
}

export async function enqueueWeeklyDiscordPost(params: {
  reportId: string
  slug: string
  discordContent: string
}) {
  if (process.env.DISCORD_POST_WEEKLY_ENABLED !== 'true') {
    return { enqueued: false, reason: 'disabled' as const }
  }

  const reportUrl = `https://www.marild.com/reports/${params.slug}`
  const content = `${params.discordContent}\n\nFull report: ${reportUrl}`.trim().slice(0, 1900)

  const { error } = await supabaseAdmin.from('outbound_posts').insert({
    report_id: params.reportId,
    channel: 'discord_weekly',
    status: 'pending',
    payload: { slug: params.slug, content },
    attempt_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(`Failed to enqueue discord_weekly outbound post: ${error.message}`)
  }

  return { enqueued: true as const }
}
