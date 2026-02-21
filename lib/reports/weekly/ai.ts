import OpenAI from 'openai'
import { z } from 'zod'
import type { WeeklyExecutionMetrics } from '@/lib/reports/weekly/metrics'

const DEFAULT_MODEL = 'gpt-5.1-chat-latest'

const clampLen = (max: number) => z.string().trim().min(1).max(max)

export const WeeklyReportJsonSchema = z.object({
  title: z.string().trim().min(1),
  summary_paragraphs: z.array(z.string().trim().min(1)).min(1).max(3),
  week_in_numbers: z.array(z.string().trim().min(1)).min(4).max(7),
  system_behavior: z.array(z.string().trim().min(1)).min(3).max(6),
  market_context: z.array(z.string().trim().min(1)).max(5),
  disclaimer: z.string().trim().min(1),
  excerpt: clampLen(200),
  social: z.object({
    discord_weekly: clampLen(1400),
    discord_trades_footer: clampLen(200),
    x: clampLen(280),
    email_subject: clampLen(78),
    email_preview: clampLen(120),
    email_body_short: clampLen(1400),
  }),
  seo: z.object({
    meta_description: clampLen(160),
  }),
})

export type WeeklyReportJson = z.infer<typeof WeeklyReportJsonSchema>

function isNonProd(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }
  return new OpenAI({ apiKey })
}

function fallbackWeeklyReportJson(params: { slug: string }): WeeklyReportJson {
  const { slug } = params
  const reportUrl = `https://www.marild.com/reports/${slug}`
  const trustUrl = 'https://www.marild.com/trust'

  // Canned, schema-valid, institutional tone. Numbers are intentionally omitted.
  return {
    title: `Weekly Execution Report — ${slug}`,
    summary_paragraphs: [
      'This weekly execution report is a factual summary of closed trades recorded in the execution ledger for the specified week.',
      'A detailed breakdown is available in the full report. All metrics in the report are computed from database records; narrative sections are template-generated in non-production environments.',
    ],
    week_in_numbers: [
      'Closed-trade metrics are available in the report details.',
      'All figures are computed from recorded executions only.',
      'No predictions, advice, or forward-looking statements are included.',
      'See the full report for the complete week summary.',
    ],
    system_behavior: [
      'Trades included are closed trades only (by exit timestamp).',
      'Metrics are computed deterministically from stored trade records.',
      'This content is a non-production fallback when OpenAI is not configured.',
    ],
    market_context: [],
    disclaimer: 'For informational purposes only. This is not investment advice and does not constitute an offer or solicitation.',
    excerpt: 'Factual weekly execution summary (non-production fallback).',
    social: {
      discord_weekly: `Weekly Execution Report (${slug}).\n${reportUrl}\nVerify live performance: ${trustUrl}`,
      discord_trades_footer: `Full ledger: ${trustUrl}`,
      x: `Weekly Execution Report (${slug}) ${reportUrl}`.slice(0, 280),
      email_subject: `Weekly Execution Report (${slug})`.slice(0, 78),
      email_preview: 'Weekly execution summary (closed trades only).'.slice(0, 120),
      email_body_short: `Weekly execution summary for ${slug}.\n\nFull report: ${reportUrl}\nVerify live performance: ${trustUrl}`.slice(0, 1400),
    },
    seo: {
      meta_description: 'Weekly execution report (closed trades only).'.slice(0, 160),
    },
  }
}

function getModel(): string {
  return (process.env.WEEKLY_REPORT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL
}

function buildSystemPrompt(): string {
  return [
    'You write institutional-grade weekly execution reports for a live trading system.',
    'Hard rules:',
    '- Factual only. No predictions, no advice, no guarantees.',
    '- Only reference metrics explicitly present in the provided metrics_json. Do not compute new metrics.',
    '- If a metric is missing, omit it.',
    '- Do not mention AI, models, or generation.',
    '- Output must be valid JSON and match the schema exactly.',
  ].join('\n')
}

function buildUserPrompt(params: { metrics: WeeklyExecutionMetrics; slug: string }): string {
  const { metrics, slug } = params
  const reportUrl = `https://www.marild.com/reports/${slug}`
  const trustUrl = 'https://www.marild.com/trust'

  return [
    'metrics_json (authoritative facts):',
    JSON.stringify(metrics),
    '',
    'Style:',
    '- Institutional tone. Clear, concise, non-promotional.',
    '- If closed_trades is 0, explicitly state “No closed trades this week”.',
    '- Include a short disclaimer line.',
    '',
    'Links you may use in social fields:',
    `- Full report: ${reportUrl}`,
    `- Verify live performance: ${trustUrl}`,
    '',
    'Return JSON that matches the schema. social.discord_weekly should be ready to post to Discord and should include the full report link.',
  ].join('\n')
}

function jsonSchemaForStructuredOutput() {
  // Keep schema small and strict; Zod validation is the final gate.
  // This is best-effort: some models/accounts may not support json_schema.
  return {
    name: 'weekly_execution_report',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title',
        'summary_paragraphs',
        'week_in_numbers',
        'system_behavior',
        'market_context',
        'disclaimer',
        'excerpt',
        'social',
        'seo',
      ],
      properties: {
        title: { type: 'string' },
        summary_paragraphs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
        week_in_numbers: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 7 },
        system_behavior: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
        market_context: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 5 },
        disclaimer: { type: 'string' },
        excerpt: { type: 'string' },
        social: {
          type: 'object',
          additionalProperties: false,
          required: [
            'discord_weekly',
            'discord_trades_footer',
            'x',
            'email_subject',
            'email_preview',
            'email_body_short',
          ],
          properties: {
            discord_weekly: { type: 'string' },
            discord_trades_footer: { type: 'string' },
            x: { type: 'string' },
            email_subject: { type: 'string' },
            email_preview: { type: 'string' },
            email_body_short: { type: 'string' },
          },
        },
        seo: {
          type: 'object',
          additionalProperties: false,
          required: ['meta_description'],
          properties: {
            meta_description: { type: 'string' },
          },
        },
      },
    },
  }
}

export async function generateWeeklyReportJson(params: {
  metrics: WeeklyExecutionMetrics
  slug: string
}): Promise<WeeklyReportJson> {
  const { metrics, slug } = params

  // If OpenAI is not configured, always fall back to a deterministic
  // template so weekly reports can still be generated in production.
  if (!process.env.OPENAI_API_KEY) {
    return fallbackWeeklyReportJson({ slug })
  }

  const openai = getOpenAIClient()
  const model = getModel()
  const system = buildSystemPrompt()
  const user = buildUserPrompt({ metrics, slug })

  // Prefer Structured Outputs JSON schema when supported; fall back to json_object.
  let content: string | null = null

  try {
    try {
      const resp = await openai.chat.completions.create({
        model,
        // NOTE: Some models (incl. certain gpt-5.* variants) only support the default temperature.
        // Omit temperature to remain compatible.
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: jsonSchemaForStructuredOutput() },
      })

      content = resp.choices?.[0]?.message?.content ?? null
    } catch (_err) {
      // Fallback for models/accounts without json_schema support.
      const resp = await openai.chat.completions.create({
        model,
        // Omit temperature for broadest compatibility.
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Most widely supported JSON mode.
        response_format: { type: 'json_object' },
      })

      content = resp.choices?.[0]?.message?.content ?? null
    }

    if (!content || typeof content !== 'string') {
      throw new Error('OpenAI returned empty content')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('OpenAI response was not valid JSON')
    }

    const validated = WeeklyReportJsonSchema.safeParse(parsed)
    if (!validated.success) {
      throw new Error(`Weekly report JSON failed schema validation: ${validated.error.message}`)
    }

    return validated.data
  } catch (_err) {
    // If anything in the OpenAI pipeline fails (network, auth, schema,
    // etc.), fall back to a deterministic template so the report job
    // cannot fail.
    return fallbackWeeklyReportJson({ slug })
  }
}
