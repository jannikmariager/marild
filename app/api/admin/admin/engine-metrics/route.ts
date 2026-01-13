import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const STARTING_EQUITY = 100000

// Ensure UI labels match sidebar navigation and expected naming
const LABEL_OVERRIDES: Record<string, string> = {
  SWING_V1_EXPANSION: 'Baseline (Swing Expansion)',
  SWING_FAV8_SHADOW: 'SWING_FAV8_SHADOW',
  SWING_V2_ROBUST: 'SWING_V2_ROBUST',
  SWING_V1_12_15DEC: 'SWING_V1_12_15DEC',
  SCALP_V1_MICROEDGE: 'SCALP_V1_MICROEDGE',
  v1: 'Crypto V1', // crypto shadow uses engine_version = 'v1'
}

async function fetchJournalTotals(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: closedTrades, error: closedTradesError } = await supabase
    .from('live_trades')
    .select('realized_pnl_dollars')
    .eq('strategy', 'SWING')
    .eq('engine_key', 'SWING')
    .not('exit_timestamp', 'is', null)

  if (closedTradesError) throw closedTradesError

  const { data: openPositions, error: openPositionsError } = await supabase
    .from('live_positions')
    .select('unrealized_pnl_dollars')
    .eq('strategy', 'SWING')
    .eq('engine_key', 'SWING')

  if (openPositionsError) throw openPositionsError

  const sinceInceptionRealized = (closedTrades || []).reduce(
    (sum, trade) => sum + Number(trade.realized_pnl_dollars ?? 0),
    0,
  )
  const currentUnrealized = (openPositions || []).reduce(
    (sum, pos) => sum + Number(pos.unrealized_pnl_dollars ?? 0),
    0,
  )

  const currentEquity = STARTING_EQUITY + sinceInceptionRealized + currentUnrealized
  const netReturn = ((currentEquity - STARTING_EQUITY) / STARTING_EQUITY) * 100

  return {
    starting_equity: STARTING_EQUITY,
    current_equity: currentEquity,
    since_inception_realized_pnl: sinceInceptionRealized,
    current_unrealized_pnl: currentUnrealized,
    net_return_pct: netReturn,
  }
}

const isToday = (timestamp?: string | null, dayString?: string) => {
  if (!timestamp) return false
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return false
  const compareDate = dayString ?? new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10) === compareDate
}

const ALLOWED_EMAILS = ['jannikmariager@gmail.com']

export async function GET(request: NextRequest) {
  try {
    const requestDate = new Date().toISOString().slice(0, 10)
    const supabaseAuth = await createClient()
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Check auth via cookies first
    const {
      data: { user: cookieUser },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    let user = cookieUser

    // Allow bearer token from Authorization header as fallback (mobile clients)
    if ((!user || authError) && request) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length).trim()
        if (token.length > 0) {
          const {
            data: { user: tokenUser },
          } = await supabase.auth.getUser(token)
          if (tokenUser) {
            user = tokenUser
          }
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!ALLOWED_EMAILS.includes((user.email || '').toLowerCase())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all engine versions (PRIMARY and SHADOW)
    const { data: engineVersions, error: versionsError } = await supabase
      .from('engine_versions')
      .select('*')
      .order('created_at', { ascending: false })

    if (versionsError) {
      console.error('Error fetching engine_versions:', versionsError)
      return NextResponse.json({ error: 'Failed to fetch engine versions' }, { status: 500 })
    }

    const metrics: any[] = []
    let heartbeatStatus: any = null

    try {
      const hbResp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/system_heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      })
      if (hbResp.ok) {
        heartbeatStatus = await hbResp.json()
      } else {
        heartbeatStatus = {
          ok: false,
          results: [],
          error: `Heartbeat HTTP ${hbResp.status}`,
        }
      }
    } catch (hbError) {
      console.error('Error invoking system_heartbeat:', hbError)
      heartbeatStatus = {
        ok: false,
        results: [],
        error: (hbError as Error).message ?? 'Heartbeat invocation failed',
      }
    }

    for (const version of engineVersions || []) {
      const isPrimary = version.run_mode === 'PRIMARY'
      const isCrypto = (version.asset_class ?? '').toLowerCase() === 'crypto' || version.engine_key === 'CRYPTO_V1_SHADOW'

      let tradeData: any[] = []
      let portfolioData: any[] = []

      let unrealizedPnl = 0

      if (isPrimary) {
        // PRIMARY: LIVE SWING engine only — same source of truth as webapp summary
        const { data: trades, error: tradesError } = await supabase
          .from('live_trades')
          .select(
            'ticker, side, entry_timestamp, entry_price, exit_timestamp, exit_price, realized_pnl_dollars, realized_pnl_r',
          )
          .eq('strategy', 'SWING')
          .eq('engine_key', 'SWING')
          .order('exit_timestamp', { ascending: false })

        if (tradesError) {
          console.error(`Error fetching live_trades for ${version.engine_version}:`, tradesError)
          continue
        }

        tradeData = (trades || []).map((trade) => ({
          ticker: trade.ticker,
          side: trade.side,
          entry_timestamp: trade.entry_timestamp,
          entry_price: trade.entry_price,
          exit_timestamp: trade.exit_timestamp,
          exit_price: trade.exit_price,
          realized_pnl_dollars: trade.realized_pnl_dollars,
          realized_pnl_r: trade.realized_pnl_r,
        }))

        // Get historical portfolio snapshots for equity curve only (UI chart)
        const { data: portfolio, error: portfolioError } = await supabase
          .from('live_portfolio_state')
          .select('equity_dollars, timestamp')
          .eq('strategy', 'SWING')
          .order('timestamp', { ascending: false })
          .limit(1000)

        if (portfolioError) {
          console.error(`Error fetching live_portfolio_state:`, portfolioError)
          // Do not block metrics; just omit chart data
          portfolioData = []
        } else {
          // Reverse to get chronological order for equity curve
          portfolioData = (portfolio || []).reverse()
        }
      } else {
        // SHADOW: get data from engine_* tables (stocks) or engine_crypto_* (crypto)
        if (isCrypto) {
          const { data: trades, error: tradesError } = await supabase
            .from('engine_crypto_trades')
            .select('symbol, side, price, qty, pnl, executed_at, action')
            .eq('engine_key', version.engine_key)
            .eq('version', version.engine_version)
            .order('executed_at', { ascending: false })

          if (tradesError) {
            console.error(`Error fetching engine_crypto_trades for ${version.engine_version}:`, tradesError)
            continue
          }

          tradeData = (trades || []).map((t: any) => ({
            ticker: t.symbol,
            side: t.side === 'sell' ? 'SHORT' : 'LONG',
            entry_price: t.price,
            exit_price: t.price,
            realized_pnl_dollars: t.pnl,
            realized_pnl_r: null,
            exit_timestamp: t.executed_at,
            entry_timestamp: t.executed_at,
          }))

          const { data: portfolio, error: portfolioError } = await supabase
            .from('engine_crypto_portfolio_state')
            .select('equity, unrealized, realized, ts')
            .eq('engine_key', version.engine_key)
            .eq('version', version.engine_version)
            .order('ts', { ascending: true })
            .limit(1000)

          if (portfolioError) {
            console.error(`Error fetching engine_crypto_portfolio_state for ${version.engine_version}:`, portfolioError)
            continue
          }

          portfolioData = (portfolio || []).map((p: any) => ({
            equity_dollars: p.equity,
            timestamp: p.ts,
            unrealized: p.unrealized ?? 0,
            realized: p.realized ?? 0,
          }))

          // Sum open position unrealized PnL to include in totals
          const { data: openPositions, error: openError } = await supabase
            .from('engine_crypto_positions')
            .select('unrealized_pnl')
            .eq('engine_key', version.engine_key)
            .eq('version', version.engine_version)
            .eq('status', 'open')

          if (!openError && openPositions) {
            unrealizedPnl = openPositions.reduce(
              (sum, pos) => sum + Number(pos.unrealized_pnl ?? 0),
              0,
            )
          }
        } else {
          const { data: trades, error: tradesError } = await supabase
            .from('engine_trades')
            .select('ticker, side, entry_price, exit_price, realized_pnl, realized_r, closed_at, opened_at')
            .eq('engine_key', version.engine_key)
            .eq('engine_version', version.engine_version)
            .eq('run_mode', version.run_mode)
            .order('closed_at', { ascending: false })

          if (tradesError) {
            console.error(`Error fetching engine_trades for ${version.engine_version}:`, tradesError)
            continue
          }

          tradeData = (trades || []).map((t: any) => ({
            ticker: t.ticker,
            side: t.side,
            entry_price: t.entry_price,
            exit_price: t.exit_price,
            realized_pnl_dollars: t.realized_pnl,
            realized_pnl_r: t.realized_r,
            exit_timestamp: t.closed_at,
            entry_timestamp: t.opened_at,
          }))

          const { data: portfolio, error: portfolioError } = await supabase
            .from('engine_portfolios')
            .select('equity, updated_at')
            .eq('engine_key', version.engine_key)
            .eq('engine_version', version.engine_version)
            .eq('run_mode', version.run_mode)

          if (portfolioError) {
            console.error(`Error fetching engine_portfolios for ${version.engine_version}:`, portfolioError)
            continue
          }

          // For shadow, we only have current snapshot, not historical
          portfolioData = portfolio?.[0]
            ? [
                {
                  equity_dollars: portfolio[0].equity,
                  timestamp: portfolio[0].updated_at,
                },
              ]
            : []
        }
      }

      // Calculate metrics
      const totalTrades = tradeData.length
      const winners = tradeData.filter((t: any) => (t.realized_pnl_dollars || 0) > 0).length
      const losers = tradeData.filter((t: any) => (t.realized_pnl_dollars || 0) < 0).length
      const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0

      if (isPrimary) {
        const { data: openPositions, error: openPositionsError } = await supabase
          .from('live_positions')
          .select('unrealized_pnl_dollars')
          .eq('strategy', 'SWING')
          .eq('engine_key', 'SWING')

        if (openPositionsError) {
          console.error(`Error fetching live_positions for ${version.engine_version}:`, openPositionsError)
        } else {
          unrealizedPnl = (openPositions || []).reduce(
            (sum, pos) => sum + Number(pos.unrealized_pnl_dollars ?? 0),
            0,
          )
        }
      }

      const totalRealized = tradeData.reduce((sum: number, t: any) => sum + (t.realized_pnl_dollars || 0), 0)
      const todaysRealized = tradeData.reduce(
        (sum: number, t: any) => (isToday(t.exit_timestamp, requestDate) ? sum + (t.realized_pnl_dollars || 0) : sum),
        0,
      )
      const todaysLivePnl = todaysRealized + unrealizedPnl
      const totalPnl = totalRealized + unrealizedPnl
      const avgR = tradeData.length > 0
        ? tradeData.reduce((sum: number, t: any) => sum + (t.realized_pnl_r || 0), 0) / tradeData.length
        : 0

      // Calculate max drawdown (simplified)
      let maxDrawdown = 0
      if (portfolioData.length > 0) {
        let peak = portfolioData[0]?.equity_dollars || 100000
        for (const snapshot of portfolioData) {
          const equity = snapshot.equity_dollars || 0
          if (equity > peak) {
            peak = equity
          } else {
            const drawdown = ((peak - equity) / peak) * 100
            if (drawdown > maxDrawdown) {
              maxDrawdown = drawdown
            }
          }
        }
      }

      const startingEquity = 100000

      // Current equity for PRIMARY LIVE engine: starting + realized + unrealized
      let currentEquity = startingEquity
      if (isPrimary) {
        currentEquity = startingEquity + totalRealized + unrealizedPnl
      } else {
        // For shadow engines, fall back to portfolio snapshot if available
        if (portfolioData.length > 0) {
          const mostRecent = portfolioData[portfolioData.length - 1] as any
          currentEquity = mostRecent?.equity_dollars || mostRecent?.equity || startingEquity
        }
      }

      const netReturn = ((currentEquity - startingEquity) / startingEquity) * 100

      const recentTrades = [...tradeData]
        .sort((a: any, b: any) => {
          const aTime = a.exit_timestamp ? new Date(a.exit_timestamp).getTime() : 0
          const bTime = b.exit_timestamp ? new Date(b.exit_timestamp).getTime() : 0
          return bTime - aTime
        })
        .slice(0, 100) // Return up to 100 recent trades for subpage display

      // Fetch engine parameters if applicable
      let engineParams: any = {}
      
      if (version.engine_version === 'SCALP_V1_MICROEDGE') {
        // Always start with defaults
        engineParams = {
          min_confidence_pct: 60,
          target_r_low: 0.15,
          target_r_default: 0.20,
          target_r_high: 0.30,
          stop_r: 0.12,
          risk_pct_per_trade: 0.15,
          max_concurrent_positions: 4,
          time_limit_minutes: 30,
          overnight_force_close_utc_time: '19:55:00',
        }
        
        // Try to fetch from database and override defaults
        const { data: params, error: paramsError } = await supabase
          .from('scalp_engine_config')
          .select('*')
          .eq('engine_key', 'SCALP')
          .eq('engine_version', version.engine_version)
          .single()

        if (!paramsError && params) {
          engineParams = {
            min_confidence_pct: params.min_confidence_pct || engineParams.min_confidence_pct,
            target_r_low: params.target_r_low || engineParams.target_r_low,
            target_r_default: params.target_r_default || engineParams.target_r_default,
            target_r_high: params.target_r_high || engineParams.target_r_high,
            stop_r: params.stop_r || engineParams.stop_r,
            risk_pct_per_trade: params.risk_pct_per_trade || engineParams.risk_pct_per_trade,
            max_concurrent_positions: params.max_concurrent_positions || engineParams.max_concurrent_positions,
            time_limit_minutes: params.time_limit_minutes || engineParams.time_limit_minutes,
            overnight_force_close_utc_time: params.overnight_force_close_utc_time || engineParams.overnight_force_close_utc_time,
          }
        }
      } else if (version.engine_version === 'SWING_V2_ROBUST' || version.engine_version === 'SWING_V1_12_15DEC') {
        // Fetch promoted tickers for SWING engines
        const { data: promotedTickers, error: tickersError } = await supabase
          .from('promoted_tickers')
          .select('ticker, avg_confidence, signal_count')
          .eq('engine_version', version.engine_version)
          .eq('is_promoted', true)
          .order('signal_count', { ascending: false })

        if (!tickersError && promotedTickers) {
          const tickerList = promotedTickers.map((t: any) => t.ticker).join(', ')
          engineParams = {
            promoted_tickers: tickerList,
            promoted_ticker_count: promotedTickers.length,
            strategy_type: version.engine_version === 'SWING_V2_ROBUST' ? 'Aggressive profit-locking' : 'Conservative baseline',
          }
          
          // Add version-specific parameters
          if (version.engine_version === 'SWING_V2_ROBUST') {
            engineParams.tp_activation = '1.0R (faster)'
            engineParams.trailing_distance = '0.5R (tighter)'
            engineParams.time_exit = '0.4R (earlier)'
            engineParams.overnight_hygiene = 'Enabled'
            engineParams.hygiene_actions = '50% close at market, SL to BE, ATR-based trail'
          } else if (version.engine_version === 'SWING_V1_12_15DEC') {
            engineParams.tp_activation = '1.5R (standard)'
            engineParams.trailing_distance = '1.0R (standard)'
            engineParams.time_exit = '0.75R (standard)'
            engineParams.overnight_hygiene = 'Disabled'
            engineParams.hygiene_actions = 'None - baseline configuration'
          }
        }
      }

      metrics.push({
        engine_version: version.engine_version,
        engine_key: version.engine_key,
        run_mode: version.run_mode,
        is_enabled: version.is_enabled,
        is_user_visible: version.is_user_visible,
        started_at: version.started_at,
        stopped_at: version.stopped_at,
        total_trades: totalTrades,
        winners,
        losers,
        win_rate: winRate,
        total_pnl: totalPnl,
        todays_pnl: todaysRealized,
        todays_live_pnl: todaysLivePnl,
        avg_r: avgR,
        max_drawdown: maxDrawdown,
        current_equity: currentEquity,
        net_return: netReturn,
        equity_curve: portfolioData.map((p: any) => ({
          timestamp: p.timestamp || p.updated_at,
          equity: p.equity_dollars || p.equity || 0,
        })),
        recent_trades: recentTrades,
        display_label:
          LABEL_OVERRIDES[version.engine_version] ??
          (isCrypto ? LABEL_OVERRIDES['v1'] : undefined) ??
          version.notes ??
          version.engine_version,
        engine_params: engineParams,
      })
    }
    const journalTotals = await fetchJournalTotals(supabase)

    return NextResponse.json(
      { metrics, journal_totals: journalTotals, heartbeat: heartbeatStatus },
      { status: 200 },
    )
  } catch (error) {
    console.error('Error in engine-metrics API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
