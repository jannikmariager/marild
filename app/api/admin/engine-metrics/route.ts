import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin'

const STARTING_EQUITY = 100000

// Ensure UI labels match sidebar navigation and expected naming
const LABEL_OVERRIDES: Record<string, string> = {
  SWING_V1_EXPANSION: 'Baseline (Swing Expansion)',
  SWING_FAV8_SHADOW: 'SWING_FAV8_SHADOW',
  SWING_V2_ROBUST: 'SWING_V2_ROBUST',
  SWING_V1_12_15DEC: 'SWING_V1_12_15DEC',
  SCALP_V1_MICROEDGE: 'SCALP_V1_MICROEDGE',
  QUICK_PROFIT_V1: 'Quick profit shadow engine',
  SWING_SHADOW_CTX_V1: 'SWING Context Shadow V1',
  v1: 'Crypto V1', // crypto shadow uses engine_version = 'v1'
}

const RETIRED_SHADOW_VERSIONS = new Set(['SWING_V1_12_15DEC', 'SWING_FAV8_SHADOW'])

const ENGINE_SOURCE_ALIASES: Record<string, { engine_key: string; engine_version: string }> = {
  QUICK_PROFIT_V1: { engine_key: 'SCALP', engine_version: 'SCALP_V1_MICROEDGE' },
}

type EngineSource = { engine_key: string; engine_version: string }

const ENGINE_SOURCE_MAP: Record<string, EngineSource[]> = {
  QUICK_PROFIT_V1: [
    { engine_key: 'QUICK_PROFIT', engine_version: 'QUICK_PROFIT_V1' },
    { engine_key: 'SCALP', engine_version: 'SCALP_V1_MICROEDGE' },
  ],
}

function getEngineSources(versionKey: string, engineKey: string, engineVersion: string): EngineSource[] {
  const key = (versionKey || '').toUpperCase()
  return ENGINE_SOURCE_MAP[key] ?? [{ engine_key: engineKey, engine_version: engineVersion }]
}

type StockShadowData = {
  engine_key: string
  engine_version: string
  tradeData: any[]
  portfolioData: any[]
  openCount: number
  overrideStartingEquity: number | null
  overrideCurrentEquity: number | null
}

function directionMultiplier(side: 'LONG' | 'SHORT' | null | undefined) {
  return side === 'SHORT' ? -1 : 1
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

type ServiceSupabaseClient = SupabaseClient<any, any, any, any, any>

function baseSwingDefaults() {
  return {
    // These are descriptive defaults used across swing engines.
    starting_equity: 100000,
    risk_pct_per_trade: 0.75,
    max_per_position_pct: 25,
    max_portfolio_allocation_pct: 80,
    max_concurrent_positions: 10,
    min_ticket_usd: 1000,
  };
}

function defaultEngineParams(params: {
  versionKey: string;
  engineKey: string;
  engineVersion: string;
  runMode: string;
  isPrimary: boolean;
  isCrypto: boolean;
}): Record<string, unknown> {
  const { versionKey, engineKey, engineVersion, runMode, isPrimary, isCrypto } = params;
  const v = (versionKey || engineVersion || '').toUpperCase();
  const k = (engineKey || '').toUpperCase();

  // Primary (live) swing engine defaults
  if (isPrimary && k === 'SWING') {
    return {
      ...baseSwingDefaults(),
      strategy_type: 'Baseline swing (live)',
      tp_activation: '≈ +1.5R',
      trailing_distance: '≈ 0.75R',
      time_exit: 'contextual',
    };
  }

  // Shadow swing variants
  if (runMode === 'SHADOW' && k === 'SWING') {
    if (v === 'SWING_V2_ROBUST') {
      return {
        ...baseSwingDefaults(),
        strategy_type: 'Swing shadow (robust profit locking)',
        tp_activation: '≈ +1.0R',
        trailing_distance: '≈ 0.5R',
        time_exit: '≈ +0.4R into close',
        overnight_hygiene: 'Enabled',
      };
    }

    if (v === 'SHADOW_BRAKES_V1') {
      return {
        ...baseSwingDefaults(),
        strategy_type: 'Swing shadow (daily brakes)',
      };
    }

    if (v === 'SWING_SHADOW_CTX_V1') {
      return {
        ...baseSwingDefaults(),
        strategy_type: 'Swing shadow (market-context gate)',
        context_policy: 'CTX_V1_MINIMAL',
      };
    }

    // Generic swing shadow fallback
    return {
      ...baseSwingDefaults(),
      strategy_type: 'Swing shadow',
    };
  }

  // Quick profit / scalp family
  if (v === 'QUICK_PROFIT_V1' || v === 'SCALP_V1_MICROEDGE') {
    return {
      starting_equity: 100000,
      strategy_type: v === 'QUICK_PROFIT_V1' ? 'Quick profit shadow' : 'Scalp shadow',
    };
  }

  // Crypto shadow
  if (isCrypto || v === 'V1' || k.includes('CRYPTO')) {
    return {
      starting_equity: 100000,
      strategy_type: 'Crypto shadow',
      primary_timeframe: '15m',
      risk_pct_per_trade: 0.3,
      max_concurrent_positions: 3,
      max_daily_drawdown_pct: 2,
    };
  }

  return { starting_equity: 100000 };
}

async function fetchStockShadowData(
  supabase: ServiceSupabaseClient,
  params: { engine_key: string; engine_version: string; run_mode: string },
): Promise<StockShadowData> {
  const { engine_key, engine_version, run_mode } = params

  const { data: trades, error: tradesError } = await supabase
    .from('engine_trades')
    .select('ticker, side, entry_price, exit_price, realized_pnl, realized_r, closed_at, opened_at')
    .eq('engine_key', engine_key)
    .eq('engine_version', engine_version)
    .eq('run_mode', run_mode)
    .order('closed_at', { ascending: false })

  if (tradesError) throw tradesError

  const tradeData = (trades || []).map((t: any) => ({
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
    .select('equity, starting_equity, updated_at')
    .eq('engine_key', engine_key)
    .eq('engine_version', engine_version)
    .eq('run_mode', run_mode)
    .maybeSingle()

  if (portfolioError) throw portfolioError

  let overrideStartingEquity: number | null = null
  let overrideCurrentEquity: number | null = null

  type PortfolioRow = {
    equity: number | null
    starting_equity: number | null
    updated_at: string
  }

  const portfolioRow = portfolio as PortfolioRow | null

  const portfolioData = portfolioRow
    ? [
        {
          equity_dollars: Number(portfolioRow.equity ?? 0),
          timestamp: portfolioRow.updated_at,
        },
      ]
    : []

  if (portfolioRow) {
    overrideStartingEquity = Number(portfolioRow.starting_equity ?? 100000)
    overrideCurrentEquity = Number(portfolioRow.equity ?? overrideStartingEquity)
  }

  const { data: openPositions, error: openError } = await supabase
    .from('engine_positions')
    .select('id')
    .eq('engine_key', engine_key)
    .eq('engine_version', engine_version)
    .eq('run_mode', run_mode)
    .eq('status', 'OPEN')

  if (openError) throw openError

  return {
    engine_key,
    engine_version,
    tradeData,
    portfolioData,
    openCount: openPositions?.length ?? 0,
    overrideStartingEquity,
    overrideCurrentEquity,
  }
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

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request)
  if (adminCtx instanceof NextResponse) return adminCtx

  let supabase
  try {
    supabase = getAdminSupabaseOrThrow() as any
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  try {
    const requestDate = new Date().toISOString().slice(0, 10)

    // Fetch all engine versions (PRIMARY and SHADOW)
    const { data: engineVersions, error: versionsError } = await supabase
      .from('engine_versions')
      .select('*, settings')
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
      const versionKey = (version.engine_version || '').toUpperCase()
      if (versionKey === 'SCALP_V1_MICROEDGE') {
        // Legacy SCALP entry is superseded by the Quick profit alias
        continue
      }
      if (RETIRED_SHADOW_VERSIONS.has(versionKey)) {
        continue
      }
      const alias = ENGINE_SOURCE_ALIASES[versionKey]
      let sourceEngineKey = alias?.engine_key ?? version.engine_key
      let sourceEngineVersion = alias?.engine_version ?? version.engine_version
      const isPrimary = version.run_mode === 'PRIMARY'
      const isCrypto = (version.asset_class ?? '').toLowerCase() === 'crypto' || version.engine_key === 'CRYPTO_V1_SHADOW'

      let tradeData: any[] = []
      let portfolioData: any[] = []

      let unrealizedPnl = 0
      let overrideStartingEquity: number | null = null
      let overrideCurrentEquity: number | null = null

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

        tradeData = (trades || []).map((trade: any) => ({
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
            .eq('engine_key', sourceEngineKey)
            .eq('version', sourceEngineVersion)
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
            .eq('engine_key', sourceEngineKey)
            .eq('version', sourceEngineVersion)
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
            .eq('engine_key', sourceEngineKey)
            .eq('version', sourceEngineVersion)
            .eq('status', 'open')

          if (!openError && openPositions) {
            unrealizedPnl = openPositions.reduce(
              (sum: number, pos: any) => sum + Number(pos.unrealized_pnl ?? 0),
              0,
            )
          }
        } else {
          const candidateSources = getEngineSources(versionKey, version.engine_key, version.engine_version)
          let stockResult: StockShadowData | null = null

          for (const candidate of candidateSources) {
            try {
              const result = await fetchStockShadowData(supabase, {
                engine_key: candidate.engine_key,
                engine_version: candidate.engine_version,
                run_mode: version.run_mode,
              })
              stockResult = result
              const hasData =
                result.tradeData.length > 0 ||
                result.openCount > 0 ||
                (result.overrideStartingEquity != null &&
                  result.overrideCurrentEquity != null &&
                  Math.abs(result.overrideCurrentEquity - result.overrideStartingEquity) > 1e-6)
              if (hasData) {
                break
              }
            } catch (err) {
              console.error(
                `Error fetching shadow data for ${candidate.engine_key}/${candidate.engine_version}:`,
                err,
              )
              continue
            }
          }

          if (!stockResult) {
            continue
          }

          sourceEngineKey = stockResult.engine_key
          sourceEngineVersion = stockResult.engine_version
          tradeData = stockResult.tradeData
          portfolioData = stockResult.portfolioData
          overrideStartingEquity = stockResult.overrideStartingEquity
          overrideCurrentEquity = stockResult.overrideCurrentEquity

          // Quick profit shadow engine currently books closes in engine_positions
          // rather than engine_trades. To ensure the admin metrics reflect real
          // shadow activity, derive trade data and open-position unrealized PnL
          // from engine_positions when the engine_version is QUICK_PROFIT_V1.
          if (versionKey === 'QUICK_PROFIT_V1') {
            const { data: qpClosed, error: qpClosedError } = await supabase
              .from('engine_positions')
              .select(
                'ticker, side, entry_price, exit_price, realized_pnl, realized_r, opened_at, closed_at, status',
              )
              .eq('engine_key', sourceEngineKey)
              .eq('engine_version', sourceEngineVersion)
              .eq('run_mode', version.run_mode)
              .eq('status', 'CLOSED')

            if (qpClosedError) {
              console.error('Error fetching Quick Profit CLOSED positions for engine-metrics:', qpClosedError)
            } else if (qpClosed && qpClosed.length > 0) {
              tradeData = (qpClosed as any[]).map((p) => ({
                ticker: p.ticker,
                side: p.side,
                entry_price: p.entry_price,
                exit_price: p.exit_price,
                realized_pnl_dollars: p.realized_pnl,
                realized_pnl_r: p.realized_r,
                exit_timestamp: p.closed_at,
                entry_timestamp: p.opened_at,
              }))
            }

            // Derive unrealized PnL from current OPEN positions using live marks
            try {
              const { data: qpOpen, error: qpOpenError } = await supabase
                .from('engine_positions')
                .select('ticker, side, qty, entry_price, management_meta')
                .eq('engine_key', sourceEngineKey)
                .eq('engine_version', sourceEngineVersion)
                .eq('run_mode', version.run_mode)
                .eq('status', 'OPEN')

              if (qpOpenError) {
                console.error('Error fetching Quick Profit OPEN positions for engine-metrics:', qpOpenError)
              } else if (qpOpen && qpOpen.length > 0) {
                const positions = qpOpen as Array<{
                  ticker: string | null
                  side: 'LONG' | 'SHORT' | null
                  qty: number | string | null
                  entry_price: number | string | null
                  management_meta: Record<string, unknown> | null
                }>

                const tickers = Array.from(
                  new Set(
                    positions
                      .map((pos) => (pos.ticker || '').trim().toUpperCase())
                      .filter((ticker) => ticker.length > 0),
                  ),
                )

                let latestCloses: Record<string, number> = {}
                if (tickers.length > 0) {
                  const { data: barRows, error: barsError } = await supabase
                    .from('bars_1m')
                    .select('symbol, ts, close')
                    .in('symbol', tickers)
                    .order('ts', { ascending: false })
                    .limit(tickers.length * 50)

                  if (barsError) {
                    console.error('[engine-metrics] Failed to load bars_1m for Quick Profit marks', barsError.message ?? barsError)
                  } else if (barRows) {
                    latestCloses = {}
                    for (const row of barRows as Array<{ symbol: string; ts: string; close: number }>) {
                      const symbol = (row.symbol || '').toUpperCase()
                      if (!symbol) continue
                      if (latestCloses[symbol] !== undefined) continue
                      const val = Number(row.close)
                      if (!Number.isFinite(val)) continue
                      latestCloses[symbol] = val
                    }
                  }
                }

                let qpUnrealized = 0
                for (const pos of positions) {
                  const ticker = (pos.ticker || '').toUpperCase()
                  const entryPriceRaw = toNumber(pos.entry_price)
                  const entryPrice = entryPriceRaw ?? 0
                  const qtyRaw = toNumber(pos.qty)
                  const qty = qtyRaw ?? 0
                  const markFromBars = ticker ? latestCloses[ticker] : undefined
                  const meta = (pos.management_meta as Record<string, unknown> | null) ?? null
                  let metaMarkPrice: number | null = null
                  if (meta) {
                    const rawMetaPrice =
                      (meta as Record<string, unknown>).last_quote_price ??
                      (meta as Record<string, unknown>).mark_price ??
                      (meta as Record<string, unknown>).last_price ??
                      null
                    if (typeof rawMetaPrice === 'number' || typeof rawMetaPrice === 'string') {
                      metaMarkPrice = toNumber(rawMetaPrice)
                    }
                  }

                  const markPrice =
                    markFromBars !== undefined && Number.isFinite(markFromBars)
                      ? Number(markFromBars)
                      : metaMarkPrice ?? entryPrice

                  const direction = directionMultiplier(pos.side)

                  if (qtyRaw !== null && entryPriceRaw !== null && markPrice !== null) {
                    const pnlDollars = (markPrice - entryPrice) * qty * direction
                    if (Number.isFinite(pnlDollars)) {
                      qpUnrealized += Number(pnlDollars)
                    }
                  }
                }

                unrealizedPnl = qpUnrealized
              }
            } catch (err) {
              console.error('Error computing Quick Profit unrealized PnL for engine-metrics:', err)
            }
          }
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
            (sum: number, pos: any) => sum + Number(pos.unrealized_pnl_dollars ?? 0),
            0,
          )
        }
      }

      const totalRealized = tradeData.reduce((sum: number, t: any) => sum + (t.realized_pnl_dollars || 0), 0)
      if (!isPrimary && overrideStartingEquity != null && overrideCurrentEquity != null && versionKey !== 'QUICK_PROFIT_V1') {
        // For generic stock shadow engines, back out unrealized PnL from the
        // portfolio equity snapshot. QUICK_PROFIT_V1 uses live marks on OPEN
        // positions instead (computed above) so we avoid double-counting.
        unrealizedPnl = overrideCurrentEquity - overrideStartingEquity - totalRealized
      }
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
      // Always include a stable baseline set of defaults so Admin v2 can derive a useful description.
      const defaults = defaultEngineParams({
        versionKey,
        engineKey: sourceEngineKey,
        engineVersion: sourceEngineVersion,
        runMode: String(version.run_mode ?? ''),
        isPrimary,
        isCrypto,
      })

      let engineParams: any = { ...defaults }

      // Attach brakes config from engine_versions.settings when present
      const rawSettings = (version as any).settings || null
      if (rawSettings && typeof rawSettings === 'object' && (rawSettings as any).brakes) {
        engineParams.brakes = (rawSettings as any).brakes
      }
      
      if ((sourceEngineVersion || '').toUpperCase() === 'SCALP_V1_MICROEDGE') {
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
          .eq('engine_version', sourceEngineVersion)
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
        id: (version as any).id ?? null,
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
        unrealized_pnl: unrealizedPnl,
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
