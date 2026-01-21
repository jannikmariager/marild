import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { requireJobAuth } from '@/lib/jobs/auth'
import { marketClock } from '@/lib/marketClock'
import { aggregateBars } from '@/lib/data/aggregation'
import type { MinuteBar } from '@/lib/data/alpaca'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { evaluateVolatility, VOLATILITY_MINUTE_LOOKBACK_HOURS } from '@/lib/engine/volatility'

// Minimum 1h candle body size required to consider a setup, as a fraction of price.
// Default 0.001 (0.10%) but can be overridden via env if needed.
// Currently not enforced (see body-size filter below), but kept for future tuning.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MIN_BODY_PCT = Number(process.env.SIGNALS_MIN_BODY_PCT ?? 0.001)

interface MinuteBarRow {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

async function handle(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const logger = new JobLogger('signals_generate_1h')
  await logger.start()

  const now = DateTime.utc()
  const window1h = marketClock.candleWindow(60, now)
  const window4h = marketClock.candleWindow(240, now)

  if (!window1h || !window4h) {
    await logger.finish(false, {}, 'No completed candles available')
    return NextResponse.json({ error: 'No completed candles' }, { status: 400 })
  }

  if (!marketClock.shouldTrade(now)) {
    // Still allow generating watchlist signals during market days pre gate.
    if (!marketClock.isTradingDay(now)) {
      await logger.finish(true, { skipped: true }, undefined, { reason: 'non_trading_day' })
      return NextResponse.json({ ok: true, skipped: true })
    }
  }

  const { data: whitelistRows, error: whitelistError } = await supabaseAdmin
    .from('ticker_whitelist')
    .select('symbol')
    .eq('is_enabled', true)

  if (whitelistError) {
    await logger.finish(false, {}, whitelistError.message)
    return NextResponse.json({ error: 'Failed to load whitelist' }, { status: 500 })
  }

  const symbols = (whitelistRows || []).map((row) => row.symbol).filter(Boolean)
  if (symbols.length === 0) {
    await logger.finish(true, { processed: 0 }, undefined, { reason: 'no_symbols' })
    return NextResponse.json({ ok: true, processed: 0 })
  }

  let staleSkips = 0
  let noSetup = 0
  let inserted = 0
  const staleDetails: Array<{ symbol: string; age: number }> = []
  const noSetupSymbols: string[] = []
  const freshnessLimit = marketClock.maxDataStalenessMinutes()

  for (const symbol of symbols) {
    const volatilityWindowStart = window1h.end.minus({ hours: VOLATILITY_MINUTE_LOOKBACK_HOURS })
    const minuteWindowStart =
      window4h.start.toMillis() < volatilityWindowStart.toMillis()
        ? window4h.start
        : volatilityWindowStart

    const { data: barsRows, error: barsError } = await supabaseAdmin
      .from('bars_1m')
      .select('ts, open, high, low, close, volume')
      .eq('symbol', symbol)
      .gte('ts', minuteWindowStart.toISO())
      .order('ts', { ascending: true })

    if (barsError) {
      await logger.finish(false, {}, barsError.message)
      return NextResponse.json({ error: 'Failed to fetch bars' }, { status: 500 })
    }

    const minuteBars: MinuteBar[] = (barsRows as MinuteBarRow[]).map((row) => ({
      t: row.ts,
      o: Number(row.open),
      h: Number(row.high),
      l: Number(row.low),
      c: Number(row.close),
      v: row.volume ?? undefined,
    }))

    if (minuteBars.length === 0) {
      staleSkips += 1
      staleDetails.push({ symbol, age: Number.POSITIVE_INFINITY })
      continue
    }

    const latestTs = DateTime.fromISO(minuteBars[minuteBars.length - 1].t, { zone: 'utc' })
    const ageMinutes = Math.abs(now.diff(latestTs, 'minutes').minutes)
    if (ageMinutes > freshnessLimit) {
      staleSkips += 1
      staleDetails.push({ symbol, age: Math.round(ageMinutes * 10) / 10 })
      continue
    }

    const oneHourBar = aggregateBars(symbol, 60, window1h, minuteBars)
    const fourHourBar = aggregateBars(symbol, 240, window4h, minuteBars)

    // Require a valid 1h candle, but do NOT block on 4h. If the 4h
    // aggregation can't be built (e.g. early in the session before
    // there is enough data), we still emit a signal and treat the
    // higher timeframe as neutral.
    if (!oneHourBar) {
      noSetup += 1
      noSetupSymbols.push(symbol)
      continue
    }

    const body = oneHourBar.close - oneHourBar.open
    const bodyPct = Math.abs(body) / oneHourBar.open
    // TEMP: disable minimum body-size filter so we always emit a signal when
    // we have a valid 1h/4h bar. Signal quality is still reflected in
    // confidence (which uses bodyPct) and trend alignment.
    // if (bodyPct < MIN_BODY_PCT) {
    //   noSetup += 1
    //   noSetupSymbols.push(symbol)
    //   continue
    // }

    const direction = body > 0 ? 'buy' : 'sell'

    let trend = 0
    let trendAligned = true
    if (fourHourBar) {
      trend = fourHourBar.close - fourHourBar.open
      trendAligned = (direction === 'buy' && trend >= 0) || (direction === 'sell' && trend <= 0)
    }

    const confidence = Math.min(100, Math.round(bodyPct * 10000 + (trendAligned ? 10 : 0)))

    const entry = oneHourBar.close
    const stop =
      direction === 'buy'
        ? Math.min(oneHourBar.low, entry * 0.995)
        : Math.max(oneHourBar.high, entry * 1.005)
    const tp1 = direction === 'buy' ? entry * 1.015 : entry * 0.985
    const tp2 = direction === 'buy' ? entry * 1.03 : entry * 0.97

    const tradeGateAllowed = !marketClock.isPreTradeGate(now)
    const tradeGateReason = tradeGateAllowed ? 'TRADE_ALLOWED' : 'PRE_MARKET_BLOCK'
    const blockedUntil = tradeGateAllowed ? null : marketClock.config.tradeStartEt
    const status = tradeGateAllowed ? 'active' : 'watchlist'

    const aiEnriched = false
    const reasoning = trendAligned
      ? `Trend-aligned ${direction.toUpperCase()} setup with ${confidence}% confidence.`
      : `Counter-trend ${direction.toUpperCase()} setup; awaiting confirmation.`

    await supabaseAdmin
      .from('ai_signals')
      .update({ status: 'invalidated', updated_at: new Date().toISOString() })
      .eq('symbol', symbol)
      .eq('timeframe', '1h')
      .in('status', ['active', 'watchlist'])
      .neq('signal_bar_ts', window1h.end.toISO())

    const volatility = await evaluateVolatility({
      symbol,
      timeframe: '1h',
      minuteBars,
      latestWindowEnd: window1h.end,
      supabase: supabaseAdmin,
    })

    const insertPayload = {
      symbol,
      timeframe: '1h',
      signal_bar_ts: window1h.end.toISO(),
      signal_type: direction,
      confidence_score: confidence,
      setup_type: trendAligned ? 'trend_follow' : 'counter_trend',
      status,
      entry_price: entry,
      stop_loss: stop,
      take_profit_1: tp1,
      take_profit_2: tp2,
      reasoning: aiEnriched ? reasoning : `${reasoning} AI enrichment unavailable.`,
      ai_decision: direction === 'buy' ? 'long' : 'short',
      ai_enriched: aiEnriched,
      data_freshness_minutes: Math.round(ageMinutes),
      trade_gate_allowed: tradeGateAllowed,
      trade_gate_reason: tradeGateReason,
      blocked_until_et: blockedUntil,
      trade_gate_et_time: marketClock.config.tradeStartEt,
      engine_type: 'SWING',
      engine_key: 'SWING',
      engine_style: 'Trend',
      volatility_state: volatility.state,
      volatility_percentile: volatility.percentile,
      volatility_explanation: volatility.explanation,
      volatility_atr: volatility.atr,
    }

    const { error: upsertError } = await supabaseAdmin
      .from('ai_signals')
      .upsert(insertPayload, { onConflict: 'symbol,timeframe,signal_bar_ts' })

    if (upsertError) {
      await logger.finish(false, {}, upsertError.message)
      return NextResponse.json({ error: 'Failed to upsert ai_signals' }, { status: 500 })
    }

    inserted += 1
  }

  await logger.finish(
    true,
    { inserted, staleSkips, noSetup },
    undefined,
    { staleDetails, noSetupSymbols },
  )
  return NextResponse.json({ ok: true, inserted, staleSkips, noSetup, staleDetails, noSetupSymbols })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
