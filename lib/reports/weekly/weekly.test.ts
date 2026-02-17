import { describe, expect, it } from 'vitest'
import { computeWeeklyExecutionMetricsFromTrades } from '@/lib/reports/weekly/metrics'
import { WeeklyReportJsonSchema } from '@/lib/reports/weekly/ai'

describe('weekly execution metrics', () => {
  it('caps profit factor to 99 when there are wins and no losses', () => {
    const metrics = computeWeeklyExecutionMetricsFromTrades({
      weekStartNyKey: '2026-02-09',
      weekEndNyKey: '2026-02-13',
      realized_before_week: 0,
      trades: [
        {
          id: 't1',
          ticker: 'AAPL',
          side: 'LONG',
          entry_price: 100,
          exit_price: 110,
          entry_timestamp: '2026-02-10T15:00:00.000Z',
          exit_timestamp: '2026-02-10T20:00:00.000Z',
          exit_reason: 'TP_HIT',
          realized_pnl_dollars: 50,
        },
      ],
    })

    expect(metrics.closed_trades).toBe(1)
    expect(metrics.profit_factor).toBe(99)
    expect(metrics.pf_note).toBeTruthy()
  })

  it('computes drawdown from a closed-trade equity path', () => {
    const metrics = computeWeeklyExecutionMetricsFromTrades({
      weekStartNyKey: '2026-02-09',
      weekEndNyKey: '2026-02-13',
      realized_before_week: 0,
      trades: [
        {
          id: 't1',
          ticker: 'AAPL',
          side: 'LONG',
          entry_price: 100,
          exit_price: 101,
          entry_timestamp: '2026-02-10T15:00:00.000Z',
          exit_timestamp: '2026-02-10T20:00:00.000Z',
          exit_reason: 'OTHER',
          realized_pnl_dollars: 100,
        },
        {
          id: 't2',
          ticker: 'MSFT',
          side: 'LONG',
          entry_price: 100,
          exit_price: 99,
          entry_timestamp: '2026-02-11T15:00:00.000Z',
          exit_timestamp: '2026-02-11T20:00:00.000Z',
          exit_reason: 'SL_HIT',
          realized_pnl_dollars: -200,
        },
      ],
    })

    // Starting equity is 100,000. After +100, peak=100,100. After -200, equity=99,900.
    // Drawdown = (100,100-99,900)/100,100*100 ≈ 0.1998%
    expect(metrics.max_drawdown_pct).toBeGreaterThan(0)
    expect(metrics.max_drawdown_pct).toBeLessThan(1)
    expect(metrics.drawdown_method).toBe('closed_trade_equity_path')
  })
})

describe('weekly report json schema', () => {
  it('rejects invalid report payload', () => {
    const bad = { title: 'x' }
    const parsed = WeeklyReportJsonSchema.safeParse(bad)
    expect(parsed.success).toBe(false)
  })

  it('accepts a minimal valid payload', () => {
    const good = {
      title: 'Weekly Execution Report — Week of Feb 10 – Feb 14, 2026',
      summary_paragraphs: ['Summary.'],
      week_in_numbers: ['A', 'B', 'C', 'D'],
      system_behavior: ['A', 'B', 'C'],
      market_context: [],
      disclaimer: 'For informational purposes only.',
      excerpt: 'Short excerpt.',
      social: {
        discord_weekly: 'Weekly update. https://www.marild.com/reports/2026-02-14',
        discord_trades_footer: 'Full ledger: https://www.marild.com/trust',
        x: 'Weekly update.',
        email_subject: 'Weekly Execution Report',
        email_preview: 'Weekly summary',
        email_body_short: 'Weekly summary body',
      },
      seo: { meta_description: 'Weekly execution report summary.' },
    }

    const parsed = WeeklyReportJsonSchema.safeParse(good)
    expect(parsed.success).toBe(true)
  })
})
