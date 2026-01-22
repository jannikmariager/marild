import { NextRequest, NextResponse } from 'next/server'
import { requireJobAuth } from '@/lib/jobs/auth'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.SIGNALS_ENRICH_MODEL || 'gpt-4o-mini'
const MAX_BATCH_SIZE = Number(process.env.SIGNALS_ENRICH_BATCH_SIZE || 10)

interface AISignalForEnrichment {
  id: string
  symbol: string
  timeframe: string
  signal_type: string
  entry_price: number | null
  stop_loss: number | null
  take_profit_1: number | null
  take_profit_2: number | null
  confidence_score: number | null
  correction_risk: number | null
  volatility_state: string | null
  volatility_percentile: number | null
  setup_type: string | null
  reasoning: string | null
}

interface EnrichmentResult {
  reasoning?: string
  reasons?: Record<string, string> | { items: string[] }
  correction_risk?: number
}

async function callOpenAI(signal: AISignalForEnrichment): Promise<EnrichmentResult | null> {
  if (!OPENAI_API_KEY) return null

  const payload = {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.signal_type,
    entry_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    take_profit_1: signal.take_profit_1,
    take_profit_2: signal.take_profit_2,
    confidence_score: signal.confidence_score,
    correction_risk: signal.correction_risk,
    volatility_state: signal.volatility_state,
    volatility_percentile: signal.volatility_percentile,
    setup_type: signal.setup_type,
  }

  const systemPrompt =
    'You are an institutional-grade trading analyst. Given a deterministic swing trade signal, produce clear, concise analysis suitable for a trading journal. Respond ONLY with a single JSON object.'

  const userPrompt = `Signal JSON (fields may be null):\n${JSON.stringify(payload)}\n\nReturn JSON with this shape:\n{\n  "reasoning": string,\n  "reasons": {\n    "smc": string,\n    "price_action": string,\n    "volume": string,\n    "sentiment": string,\n    "fundamentals": string,\n    "macro": string,\n    "confluence": string\n  },\n  "correction_risk": number\n}\n\nUse 2–4 sentences per field, be specific but avoid fluff. If you lack information for a factor, write a short sentence explaining that rather than leaving it empty.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    console.error('[signals-enrich] OpenAI error status', response.status, await response.text())
    return null
  }

  const json = (await response.json()) as any
  const content = json?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(content) as EnrichmentResult
    return parsed
  } catch (err) {
    console.error('[signals-enrich] Failed to parse OpenAI JSON', err)
    return null
  }
}

async function handle(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const logger = new JobLogger('signals_enrich')
  await logger.start()

  if (!OPENAI_API_KEY) {
    await logger.finish(true, { selected: 0, enriched: 0, skipped: 0 }, undefined, {
      reason: 'missing_openai_key',
    })
    return NextResponse.json({ ok: true, selected: 0, enriched: 0, skipped: 0 })
  }

  const { data: signals, error } = await supabaseAdmin
    .from('ai_signals')
    .select(
      'id, symbol, timeframe, signal_type, entry_price, stop_loss, take_profit_1, take_profit_2, confidence_score, correction_risk, volatility_state, volatility_percentile, setup_type, reasoning',
    )
    .eq('ai_enriched', false)
    .eq('timeframe', '1h')
    .in('status', ['active', 'watchlist', 'filled'])
    .order('created_at', { ascending: false })
    .limit(MAX_BATCH_SIZE)

  if (error) {
    await logger.finish(false, {}, error.message)
    return NextResponse.json({ error: 'Failed to load signals for enrichment' }, { status: 500 })
  }

  const rows = (signals as AISignalForEnrichment[]) || []
  if (!rows.length) {
    await logger.finish(true, { selected: 0, enriched: 0, skipped: 0 }, undefined, {
      reason: 'no_candidates',
    })
    return NextResponse.json({ ok: true, selected: 0, enriched: 0, skipped: 0 })
  }

  let enriched = 0
  let skipped = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const row of rows) {
    try {
      const enrichment = await callOpenAI(row)
      if (!enrichment) {
        skipped += 1
        continue
      }

      const update: Record<string, any> = {
        ai_enriched: true,
        updated_at: new Date().toISOString(),
      }

      if (enrichment.reasoning) update.reasoning = enrichment.reasoning
      if (enrichment.reasons) update.reasons = enrichment.reasons
      if (typeof enrichment.correction_risk === 'number') update.correction_risk = enrichment.correction_risk

      const { error: updateError } = await supabaseAdmin
        .from('ai_signals')
        .update(update)
        .eq('id', row.id)

      if (updateError) {
        failures.push({ id: row.id, error: updateError.message })
        continue
      }

      enriched += 1
    } catch (err: any) {
      failures.push({ id: row.id, error: String(err?.message || err) })
    }
  }

  await logger.finish(
    true,
    { selected: rows.length, enriched, skipped, failures: failures.length },
    undefined,
    { failures },
  )

  return NextResponse.json({ ok: true, selected: rows.length, enriched, skipped, failures })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}