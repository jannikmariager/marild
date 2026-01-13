import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { MARKET_OPEN_VARIANTS } from '@/lib/system/marketOpenVariants'
import { currentTradingDate, isWeekendInET } from '@/lib/system/tradingDay'

// Helper: pick variant not equal to yesterday's index
function pickVariant(excludeIndex: number | null): { index: number; text: string } {
  const n = MARKET_OPEN_VARIANTS.length
  if (n === 0) throw new Error('No variants configured')
  let attempt = 0
  while (attempt < 10) {
    const idx = Math.floor(Math.random() * n)
    if (excludeIndex == null || idx !== excludeIndex) {
      return { index: idx, text: MARKET_OPEN_VARIANTS[idx] }
    }
    attempt++
  }
  // Fallback: first non-excluded
  const idx = (excludeIndex ?? -1) === 0 ? 1 : 0
  return { index: idx, text: MARKET_OPEN_VARIANTS[idx] }
}

async function postToDiscord(content: string) {
  const webhookUrl = process.env.DISCORD_ANNOUNCEMENTS_WEBHOOK_URL
  if (!webhookUrl) throw new Error('DISCORD_ANNOUNCEMENTS_WEBHOOK_URL not set')
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Plain text only; no embeds or mentions
    body: JSON.stringify({ content }),
    // Do not revalidate
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Discord webhook failed: ${res.status} ${res.statusText} ${body}`)
  }
  const json = await res.json().catch(() => null)
  return json
}

// Schema references (create this table in Supabase; see SQL below)
// Table: market_open_log
// Columns:
//   id uuid primary key default gen_random_uuid()
//   trade_date date not null
//   variant_index int2 not null
//   channel_id text
//   message_id text
//   status text not null check (status in ('success','failed'))
//   created_at timestamptz default now()
// Unique: (trade_date)

export async function GET(req: NextRequest) {
  // Protect with cron secret header
  const url = new URL(req.url)
  const headerKey = req.headers.get('x-cron-key')
  const queryKey = url.searchParams.get('key') || url.searchParams.get('cronKey')
  const cronKey = headerKey || queryKey
  if (!process.env.MARKET_OPEN_CRON_SECRET || cronKey !== process.env.MARKET_OPEN_CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true'
  const nowISO = new Date().toISOString()

  // Skip weekends (ET) unless force
  if (!dryRun && !force && isWeekendInET(nowISO)) {
    return NextResponse.json({ ok: true, skipped: 'weekend' })
  }

  // Compute trading day in ET
  const tradeDate = currentTradingDate(nowISO)

  const admin = createSupabaseAdminClient()

  // Skip US market holidays if present in calendar
  const { data: holiday, error: holidayErr } = await admin
    .from('us_market_holidays')
    .select('date')
    .eq('date', tradeDate)
    .limit(1)
    .maybeSingle()

  if (holidayErr) {
    console.error('market-open holiday select error', holidayErr)
  }

  if (!dryRun && !force && holiday) {
    return NextResponse.json({ ok: true, skipped: 'holiday' })
  }

  // Idempotency check: if a row exists for today, exit 200 silently
  const { data: existing, error: selErr } = await admin
    .from('market_open_log')
    .select('id, variant_index, status')
    .eq('trade_date', tradeDate)
    .limit(1)
    .maybeSingle()

  if (selErr) {
    // Log and fail silently
    console.error('market-open select error', selErr)
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  if (existing?.status === 'success') {
    return NextResponse.json({ ok: true, already_posted: true })
  }

  // Get yesterday's variant for no-repeat rule
  const { data: prev, error: prevErr } = await admin
    .from('market_open_log')
    .select('variant_index')
    .lt('trade_date', tradeDate)
    .order('trade_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (prevErr) {
    console.error('market-open prev error', prevErr)
  }

  const lastIdx = prev?.variant_index ?? null
  const pick = pickVariant(lastIdx)

  // Claim the trading day first to ensure idempotency across duplicate cron invocations
  const channelId = process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || '#announcements'
  const { error: claimErr } = await admin
    .from('market_open_log')
    .insert({
      trade_date: tradeDate,
      variant_index: pick.index,
      channel_id: channelId,
      status: 'pending',
    })

  if (claimErr) {
    // Another run already claimed or posted
    return NextResponse.json({ ok: true, already_posted: true })
  }

  // Attempt to post
  try {
    const discordResp = dryRun && !force ? null : await postToDiscord(pick.text)

    // Update log to success and add message id
    const messageId = discordResp?.id?.toString?.() ?? null

    const { error: updErr } = await admin
      .from('market_open_log')
      .update({
        message_id: messageId,
        status: 'success',
      })
      .eq('trade_date', tradeDate)

    if (updErr) {
      console.error('market-open update success error', updErr)
    }

    return NextResponse.json({ ok: true, variant_index: pick.index, dryRun, force })
  } catch (err) {
    const e = err as { message?: string } | Error | string;
    const message = typeof e === 'string' ? e : e?.message ?? String(e);
    console.error('market-open post error', message)

    // Mark failure (retry next day per requirements)
    const { error: failErr } = await admin
      .from('market_open_log')
      .update({ status: 'failed' })
      .eq('trade_date', tradeDate)

    if (failErr) console.error('market-open update failure error', failErr)

    // Fail silently per requirements
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
