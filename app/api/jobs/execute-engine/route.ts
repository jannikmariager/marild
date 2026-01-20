import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { requireJobAuth } from '@/lib/jobs/auth'
import { marketClock } from '@/lib/marketClock'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const DEFAULT_NOTIONAL = Number(process.env.EXECUTION_DEFAULT_NOTIONAL || 5000)

interface ActiveSignal {
  id: string
  symbol: string
  signal_type: string
  entry_price: number | null
  stop_loss: number | null
  take_profit_1: number | null
  engine_key: string | null
  engine_version: string | null
  performance_traded: boolean
  performance_trade_id: number | null
  trade_gate_allowed: boolean
  status: string
}

function positionSize(entry: number | null) {
  if (!entry || entry <= 0) return 0
  return Math.max(1, Math.round(DEFAULT_NOTIONAL / entry))
}

async function handle(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const logger = new JobLogger('execute_engine')
  await logger.start()

  const now = DateTime.utc()
  if (!marketClock.shouldTrade(now)) {
    await logger.finish(true, { skipped: true }, undefined, { reason: 'outside_trade_window' })
    return NextResponse.json({ ok: true, skipped: true })
  }

  const { data: signals, error: signalsError } = await supabaseAdmin
    .from('ai_signals')
    .select(
      'id, symbol, signal_type, entry_price, stop_loss, take_profit_1, engine_key, engine_version, performance_traded, performance_trade_id, trade_gate_allowed, status',
    )
    .eq('status', 'active')
    .eq('trade_gate_allowed', true)
    .eq('performance_traded', false)

  if (signalsError) {
    await logger.finish(false, {}, signalsError.message)
    return NextResponse.json({ error: 'Failed to load signals' }, { status: 500 })
  }

  let executed = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const signal of (signals as ActiveSignal[]) || []) {
    const size = positionSize(signal.entry_price)
    if (size === 0) {
      failures.push({ id: signal.id, error: 'invalid_entry_price' })
      continue
    }

    const side = signal.signal_type?.toLowerCase().includes('sell') ? 'SHORT' : 'LONG'
    const entryPrice = signal.entry_price ?? 0
    const notional = entryPrice * size

    const { data: tradeRows, error: tradeError } = await supabaseAdmin
      .from('live_trades')
      .insert({
        strategy: 'SWING',
        ticker: signal.symbol,
        signal_id: signal.id,
        engine_version: signal.engine_version ?? 'SIMPLIFIED_V1',
        entry_timestamp: now.toISO(),
        entry_price: entryPrice,
        size_shares: size,
        notional_at_entry: notional,
        take_profit: signal.take_profit_1,
        stop_loss: signal.stop_loss,
        side,
        engine_key: signal.engine_key ?? 'SWING',
        publishable_signal: true,
      })
      .select('id')
      .single()

    if (tradeError) {
      failures.push({ id: signal.id, error: tradeError.message })
      continue
    }

    const { error: updateError } = await supabaseAdmin
      .from('ai_signals')
      .update({
        performance_traded: true,
        performance_trade_id: tradeRows?.id ?? null,
        performance_trade_status: 'OPEN',
        status: 'filled',
      })
      .eq('id', signal.id)

    if (updateError) {
      failures.push({ id: signal.id, error: updateError.message })
      continue
    }

    executed += 1
  }

  await logger.finish(true, { executed, failures: failures.length }, undefined, { failures })
  return NextResponse.json({ ok: true, executed, failures })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
