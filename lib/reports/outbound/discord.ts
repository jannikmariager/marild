type DiscordWebhookPost = {
  content: string
}

const postJson = async (url: string, body: unknown) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Discord webhook failed (${resp.status}): ${text}`)
  }
}

export async function postWeeklyReportToDiscord(params: { webhookUrl: string; content: string }) {
  const payload: DiscordWebhookPost = {
    content: params.content.slice(0, 1900),
  }
  await postJson(params.webhookUrl, payload)
}

export type ClosedTradePayload = {
  trade_id: string
  ticker: string
  side: 'LONG' | 'SHORT'
  entry_price: number | null
  exit_price: number | null
  realized_pnl_dollars: number | null
  return_pct: number | null
  exit_reason: string | null
  exit_timestamp: string | null
}

const fmt = (n: number | null | undefined, digits = 2): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

export function formatClosedTradesBatchMessage(params: {
  trades: ClosedTradePayload[]
  footer: string
}): string {
  const { trades, footer } = params
  const lines: string[] = []
  lines.push('Closed trades (batch):')

  for (const t of trades) {
    const sym = (t.ticker || 'UNKNOWN').toUpperCase()
    const side = t.side
    const ret = t.return_pct != null ? `${fmt(t.return_pct, 2)}%` : '—'
    const pnl = t.realized_pnl_dollars != null ? `$${fmt(t.realized_pnl_dollars, 2)}` : '—'
    const reason = (t.exit_reason || 'OTHER').toString()
    lines.push(`- ${sym} ${side} • ${ret} • ${pnl} (${reason})`)
  }

  if (footer.trim()) {
    lines.push('')
    lines.push(footer.trim())
  }

  return lines.join('\n').slice(0, 1900)
}

export async function postClosedTradesBatchToDiscord(params: { webhookUrl: string; message: string }) {
  const payload: DiscordWebhookPost = { content: params.message.slice(0, 1900) }
  await postJson(params.webhookUrl, payload)
}
