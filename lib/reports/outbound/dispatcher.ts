import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  formatClosedTradesBatchMessage,
  postClosedTradesBatchToDiscord,
  postWeeklyReportToDiscord,
  type ClosedTradePayload,
} from '@/lib/reports/outbound/discord'

type OutboundRow = {
  id: string
  channel: string
  status: string
  payload: any
  attempt_count: number | null
}

const DRY_RUN = process.env.REPORT_AUTOPOST_DRYRUN === 'true'

const nowIso = () => new Date().toISOString()

async function markMany(ids: string[], patch: Record<string, unknown>) {
  if (ids.length === 0) return
  await supabaseAdmin.from('outbound_posts').update(patch).in('id', ids)
}

async function markOne(id: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from('outbound_posts').update(patch).eq('id', id)
}

export async function dispatchOutboundPosts(params?: { limit?: number }) {
  const limit = Math.max(1, Math.min(params?.limit ?? 25, 50))

  // Batch processing for discord_trades: grab up to 20 pending and send one message.
  await dispatchDiscordTradesBatch()

  // Then process remaining pending posts (weekly, stubs, etc.)
  const { data, error } = await supabaseAdmin
    .from('outbound_posts')
    .select('id,channel,status,payload,attempt_count')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load outbound_posts: ${error.message}`)
  }

  const rows = (data ?? []) as OutboundRow[]

  for (const row of rows) {
    // skip trade posts here; already handled
    if (row.channel === 'discord_trades') continue

    const attempts = Number(row.attempt_count ?? 0)
    const nextAttemptCount = attempts + 1

    if (DRY_RUN) {
      await markOne(row.id, {
        status: 'skipped',
        last_error: 'dry_run',
        attempt_count: nextAttemptCount,
        updated_at: nowIso(),
      })
      continue
    }

    try {
      if (row.channel === 'discord_weekly') {
        const url = process.env.DISCORD_WEBHOOK_WEEKLY_REPORTS
        if (!url) throw new Error('DISCORD_WEBHOOK_WEEKLY_REPORTS not configured')
        await postWeeklyReportToDiscord({ webhookUrl: url, content: String(row.payload?.content ?? '') })
        await markOne(row.id, { status: 'sent', sent_at: nowIso(), attempt_count: nextAttemptCount, updated_at: nowIso() })
        continue
      }

      // Future stubs
      await markOne(row.id, {
        status: 'skipped',
        last_error: `unsupported_channel:${row.channel}`,
        attempt_count: nextAttemptCount,
        updated_at: nowIso(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failedStatus = nextAttemptCount >= 5 ? 'failed' : 'pending'
      await markOne(row.id, {
        status: failedStatus,
        last_error: message,
        attempt_count: nextAttemptCount,
        updated_at: nowIso(),
      })
    }
  }
}

async function dispatchDiscordTradesBatch() {
  if (process.env.DISCORD_POST_TRADES_ENABLED !== 'true') {
    return
  }

  const { data, error } = await supabaseAdmin
    .from('outbound_posts')
    .select('id,channel,status,payload,attempt_count')
    .eq('status', 'pending')
    .eq('channel', 'discord_trades')
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) {
    throw new Error(`Failed to load discord_trades outbound_posts: ${error.message}`)
  }

  const rows = (data ?? []) as OutboundRow[]
  if (rows.length === 0) return

  const ids = rows.map((r) => r.id)
  const attemptsById = new Map(ids.map((id, idx) => [id, Number(rows[idx]?.attempt_count ?? 0)]))

  if (DRY_RUN) {
    await markMany(ids, { status: 'skipped', last_error: 'dry_run', updated_at: nowIso() })
    return
  }

  const url = process.env.DISCORD_WEBHOOK_LIVE_EXECUTED_TRADES
  if (!url) {
    await markMany(ids, { status: 'failed', last_error: 'DISCORD_WEBHOOK_LIVE_EXECUTED_TRADES not configured', updated_at: nowIso() })
    return
  }

  const trades: ClosedTradePayload[] = rows.map((r) => r.payload as ClosedTradePayload)
  const footer = String((rows[0]?.payload as any)?.footer ?? '').trim() || 'Full ledger: https://www.marild.com/trust'
  const message = formatClosedTradesBatchMessage({ trades, footer })

  try {
    await postClosedTradesBatchToDiscord({ webhookUrl: url, message })
    await markMany(ids, { status: 'sent', sent_at: nowIso(), updated_at: nowIso() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // increment attempt_count per row best-effort
    for (const id of ids) {
      const attempts = attemptsById.get(id) ?? 0
      const next = attempts + 1
      await markOne(id, { status: next >= 5 ? 'failed' : 'pending', attempt_count: next, last_error: msg, updated_at: nowIso() })
    }
  }
}
