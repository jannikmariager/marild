import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

const ENGINE_KEY = 'QUICK_PROFIT';
const ENGINE_VERSION = 'QUICK_PROFIT_V1';
const SOURCE_ENGINE_KEY = 'SCALP';
const SOURCE_ENGINE_VERSION = 'SCALP_V1_MICROEDGE';
const RUN_MODE = 'SHADOW';

const DEFAULT_CONFIG = {
  be_trigger_usd: 150,
  be_buffer_usd: 5,
  partial_trigger_usd: 250,
  partial_fraction: 0.5,
  trail_distance_usd: 120,
  risk_pct_per_trade: 0.0075,
  max_concurrent_positions: 10,
  max_notional_pct: 0.25,
  max_portfolio_pct: 0.8,
  min_position_notional: 1000,
  lookback_hours: 2,
};

const ENGINE_SOURCES = [
  { engine_key: ENGINE_KEY, engine_version: ENGINE_VERSION },
  { engine_key: SOURCE_ENGINE_KEY, engine_version: SOURCE_ENGINE_VERSION },
];

type DecisionRow = {
  id: string;
  ticker: string;
  decision: string;
  reason_context?: {
    pnl_usd?: number | null;
    price?: number | null;
    [key: string]: unknown;
  } | null;
  created_at: string;
};

type SourceData = {
  portfolio: { equity: number; starting_equity: number; allocated_notional: number; updated_at: string } | null;
  openPositions: Array<{ risk_dollars?: number | null }>;
  decisionRows: DecisionRow[];
};

function hasSourceData(data: SourceData) {
  return data.openPositions.length > 0 || data.decisionRows.length > 0;
}

async function fetchSourceData(
  supabase: ReturnType<typeof getAdminSupabaseOrThrow>,
  source: { engine_key: string; engine_version: string }
): Promise<SourceData> {
  const [portfolioRes, positionsRes, decisionsRes] = await Promise.all([
    supabase
      .from('engine_portfolios')
      .select('equity, starting_equity, allocated_notional, updated_at')
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .maybeSingle(),
    supabase
      .from('engine_positions')
      .select('risk_dollars')
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .eq('status', 'OPEN'),
    supabase
      .from('live_signal_decision_log')
      .select('id, ticker, decision, reason_context, created_at, reason_code')
      .eq('engine_key', source.engine_key)
      .eq('engine_version', source.engine_version)
      .eq('run_mode', RUN_MODE)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (portfolioRes.error) throw portfolioRes.error;
  if (positionsRes.error) throw positionsRes.error;
  if (decisionsRes.error) throw decisionsRes.error;

  return {
    portfolio: portfolioRes.data,
    openPositions: positionsRes.data || [],
    decisionRows: decisionsRes.data || [],
  };
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  try {
    const config = buildQuickProfitConfig();

    let sourceData = await fetchSourceData(supabase, ENGINE_SOURCES[0]);
    if (!hasSourceData(sourceData) && ENGINE_SOURCES.length > 1) {
      const fallbackData = await fetchSourceData(supabase, ENGINE_SOURCES[1]);
      if (hasSourceData(fallbackData)) {
        sourceData = fallbackData;
      }
    }

    const { portfolio, openPositions, decisionRows } = sourceData;

    const openRiskDollars = (openPositions || []).reduce(
      (sum: number, pos: { risk_dollars?: number | null }) => sum + Number(pos.risk_dollars ?? 0),
      0,
    );
    const currentRiskPct =
      portfolio && Number(portfolio.equity) > 0 ? ((openRiskDollars / Number(portfolio.equity)) * 100).toFixed(3) : '0.000';

    const decisions = (decisionRows || []).map((row: DecisionRow) => ({
      id: row.id,
      ticker: row.ticker,
      action: row.decision,
      pnl_usd: Number(row.reason_context?.pnl_usd ?? 0),
      price: Number(row.reason_context?.price ?? 0),
      created_at: row.created_at,
      metadata: row.reason_context || {},
    }));

    const openActions = decisions.filter((d) => d.action === 'OPEN').length;
    const closeActions = decisions.filter((d) => d.action === 'CLOSE').length;

    return NextResponse.json(
      {
        config,
        portfolio: {
          equity: Number(portfolio?.equity ?? 0),
          starting_equity: Number(portfolio?.starting_equity ?? 0),
          allocated_notional: Number(portfolio?.allocated_notional ?? 0),
          open_positions_count: (openPositions || []).length,
          current_risk_pct: currentRiskPct,
        },
        statistics: {
          total_decisions: decisions.length,
          open_actions: openActions,
          close_actions: closeActions,
          entry_rate: decisions.length > 0 ? ((openActions / decisions.length) * 100).toFixed(1) : '0.0',
        },
        recent_decisions: decisions,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[quick-profit-parameters] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

function buildQuickProfitConfig() {
  return {
    be_trigger_usd: numberFromEnv('QUICK_PROFIT_BE_TRIGGER_USD', DEFAULT_CONFIG.be_trigger_usd),
    be_buffer_usd: numberFromEnv('QUICK_PROFIT_BE_BUFFER_USD', DEFAULT_CONFIG.be_buffer_usd),
    partial_trigger_usd: numberFromEnv('QUICK_PROFIT_PARTIAL_TRIGGER_USD', DEFAULT_CONFIG.partial_trigger_usd),
    partial_fraction: numberFromEnv('QUICK_PROFIT_PARTIAL_FRACTION', DEFAULT_CONFIG.partial_fraction),
    trail_distance_usd: numberFromEnv('QUICK_PROFIT_TRAIL_DISTANCE_USD', DEFAULT_CONFIG.trail_distance_usd),
    risk_pct_per_trade: numberFromEnv('QUICK_PROFIT_RISK_PCT', DEFAULT_CONFIG.risk_pct_per_trade),
    max_concurrent_positions: numberFromEnv('QUICK_PROFIT_MAX_POSITIONS', DEFAULT_CONFIG.max_concurrent_positions),
    max_notional_pct: numberFromEnv('QUICK_PROFIT_MAX_NOTIONAL_PCT', DEFAULT_CONFIG.max_notional_pct),
    max_portfolio_pct: numberFromEnv('QUICK_PROFIT_MAX_PORTFOLIO_PCT', DEFAULT_CONFIG.max_portfolio_pct),
    min_position_notional: numberFromEnv('QUICK_PROFIT_MIN_NOTIONAL', DEFAULT_CONFIG.min_position_notional),
    lookback_hours: numberFromEnv('QUICK_PROFIT_LOOKBACK_HOURS', DEFAULT_CONFIG.lookback_hours),
  };
}

function numberFromEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
