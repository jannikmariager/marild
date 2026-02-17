import type { WeeklyExecutionMetrics } from '@/lib/reports/weekly/metrics'
import type { WeeklyReportJson } from '@/lib/reports/weekly/ai'

const fmtNum = (n: number, digits = 2): string => {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

const fmtPct = (n: number, digits = 2): string => {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

const fmtUsd = (n: number): string => {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const escapePipes = (s: string): string => s.replace(/\|/g, '\\|')

export function renderWeeklyReportMarkdown(params: {
  metrics: WeeklyExecutionMetrics
  report: WeeklyReportJson
  slug: string
}): { markdown: string; excerpt: string } {
  const { metrics, report, slug } = params

  const reportUrl = `https://www.marild.com/reports/${slug}`
  const trustUrl = 'https://www.marild.com/trust'

  const lines: string[] = []

  lines.push(`# ${report.title}`)
  lines.push('')
  lines.push(metrics.week_label)
  lines.push('')

  // At-a-glance
  lines.push('## At a glance')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('|---|---:|')
  lines.push(`| Closed trades | ${metrics.closed_trades} |`)
  lines.push(`| Winners / Losers | ${metrics.winners_count} / ${metrics.losers_count} |`)
  lines.push(`| Net P&L (USD) | ${fmtNum(metrics.net_pnl_usd, 2)} |`)
  lines.push(`| Net return | ${fmtPct(metrics.net_return_pct, 2)} |`)
  lines.push(`| Equity start (USD) | ${fmtNum(metrics.equity_at_week_start, 2)} |`)
  lines.push(`| Equity end (USD) | ${fmtNum(metrics.equity_at_week_end, 2)} |`)
  lines.push(`| Largest win (USD) | ${fmtNum(metrics.largest_win_usd, 2)} |`)
  lines.push(`| Largest loss (USD) | ${fmtNum(metrics.largest_loss_usd, 2)} |`)
  lines.push(`| Win rate | ${fmtPct(metrics.win_rate_pct, 2)} |`)
  lines.push(`| Profit factor | ${fmtNum(metrics.profit_factor, 2)} |`)
  lines.push(`| Max drawdown | ${fmtPct(metrics.max_drawdown_pct, 2)} |`)
  lines.push(`| Avg hold (hours) | ${fmtNum(metrics.avg_hold_hours, 1)} |`)
  lines.push('')

  lines.push('## Summary')
  lines.push('')
  // Deterministic equity summary sentence with formatted USD values.
  lines.push(
    `The system closed ${metrics.closed_trades} trades during the week of ${metrics.week_label}, ending the period with equity of ${fmtUsd(metrics.equity_at_week_end)} compared to ${fmtUsd(metrics.equity_at_week_start)} at the start.`,
  )
  lines.push('')
  for (const p of report.summary_paragraphs) {
    lines.push(p.trim())
    lines.push('')
  }

  lines.push('## Week in numbers')
  lines.push('')
  for (const b of report.week_in_numbers) {
    lines.push(`- ${b.trim()}`)
  }
  lines.push('')

  lines.push('## System behavior')
  lines.push('')
  for (const b of report.system_behavior) {
    lines.push(`- ${b.trim()}`)
  }
  lines.push('')

  if (report.market_context.length > 0) {
    lines.push('## Market context')
    lines.push('')
    for (const b of report.market_context) {
      lines.push(`- ${b.trim()}`)
    }
    lines.push('')
  }

  lines.push('## Selected trades')
  lines.push('')
  lines.push('| Date (ET) | Symbol | Dir | Entry | Exit | Return | P&L (USD) | Status |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|')
  if (metrics.selected_trades.length === 0) {
    lines.push('| — | — | — | — | — | — | — | — |')
  } else {
    for (const t of metrics.selected_trades) {
      const entry = t.entry != null ? fmtNum(t.entry, 4) : '—'
      const exit = t.exit != null ? fmtNum(t.exit, 4) : '—'
      const ret = t.return_pct != null ? fmtPct(t.return_pct, 2) : '—'
      const pnl = t.pnl_usd != null ? fmtNum(t.pnl_usd, 2) : '—'

      const rawStatus = (t.status ?? '').toUpperCase()
      const statusLabel =
        rawStatus === 'TP_HIT'
          ? 'Take Profit'
          : rawStatus === 'SL_HIT'
          ? 'Stop Loss'
          : rawStatus === 'TRAILING_SL_HIT'
          ? 'Trailing Stop'
          : rawStatus === 'PARTIAL_TP'
          ? 'Partial Take Profit'
          : rawStatus === 'TIME_EXIT' || rawStatus === 'TIME_BASED'
          ? 'Timed Exit'
          : rawStatus
          ? 'Other'
          : '—'

      lines.push(
        `| ${t.date} | ${escapePipes(t.symbol)} | ${t.dir} | ${entry} | ${exit} | ${ret} | ${pnl} | ${escapePipes(statusLabel)} |`,
      )
    }
  }
  lines.push('')

  lines.push('## Methodology')
  lines.push('')
  lines.push('- All figures are computed deterministically from closed trades recorded in the public execution ledger.')
  lines.push(`- Timezone: America/New_York (ET). Week window is ${metrics.week_start} 00:00 ET through ${metrics.week_end} 23:59 ET.`)
  lines.push(`- Drawdown method: ${metrics.drawdown_method} (equity path derived from the sequence of closed-trade realized P&L).`)
  if (metrics.pf_note) {
    lines.push(`- Profit factor note: ${metrics.pf_note}`)
  }
  lines.push('')

  lines.push('- All figures computed deterministically from closed trades in the public execution ledger. No hypothetical results.')
  lines.push('')

  lines.push('## Disclaimer')
  lines.push('')
  lines.push(report.disclaimer.trim())
  lines.push('')

  const markdown = lines.join('\n')
  const excerpt = report.excerpt.trim().slice(0, 200)

  return { markdown, excerpt }
}
