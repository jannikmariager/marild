import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STARTING_EQUITY = 100000;

type DailyRow = {
  trading_day: string;
  daily_pnl: number;
  trades_count: number;
  state: string;
  throttle_factor: number;
  halt_reason: string | null;
  winners: number;
  losers: number;
  win_rate: number | null;
  equity: number;
  drawdown_pct: number;
};

type EngineDailySeries = {
  engine_key: string;
  engine_version: string;
  run_mode: 'PRIMARY' | 'SHADOW' | string;
  display_label?: string | null;
  days: DailyRow[];
};

const clampInt = (raw: string | null, min: number, max: number, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const startDateFromDays = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(1, days) + 1);
  return isoDay(d);
};

function normalizeDayKey(raw: any): string {
  if (!raw) return '';
  if (raw instanceof Date) return isoDay(raw);
  const s = String(raw);
  return s.slice(0, 10);
}

type TradeAgg = { winners: number; losers: number };

function addAgg(map: Map<string, TradeAgg>, day: string, pnl: number) {
  if (!day) return;
  const curr = map.get(day) ?? { winners: 0, losers: 0 };
  if (pnl > 0) curr.winners += 1;
  else if (pnl < 0) curr.losers += 1;
  map.set(day, curr);
}

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = clampInt(searchParams.get('days'), 1, 365, 30);
    const since = searchParams.get('since')?.trim() || startDateFromDays(days);

    // Load engine versions first.
    const { data: versions, error: versionsError } = await supabase
      .from('engine_versions')
      .select('engine_key, engine_version, run_mode, notes')
      .order('created_at', { ascending: false });

    if (versionsError) {
      return NextResponse.json({ error: 'Failed to load engine versions' }, { status: 500 });
    }

    const engines = (versions ?? []).map((v: any) => ({
      engine_key: String(v.engine_key ?? ''),
      engine_version: String(v.engine_version ?? ''),
      run_mode: String(v.run_mode ?? ''),
      display_label: (v.notes ?? null) as string | null,
    })).filter((e: any) => e.engine_key && e.engine_version);

    // Fetch all daily states for these engines within range.
    const { data: stateRows, error: stateError } = await supabase
      .from('engine_daily_state')
      .select('engine_key, engine_version, trading_day, state, daily_pnl, trades_count, throttle_factor, halt_reason, updated_at')
      .gte('trading_day', since)
      .order('trading_day', { ascending: true });

    if (stateError) {
      return NextResponse.json({ error: 'Failed to load engine daily state' }, { status: 500 });
    }

    // Pre-group daily_state rows by engine key/version.
    const stateByEngine = new Map<string, any[]>();
    for (const r of stateRows ?? []) {
      const k = `${String((r as any).engine_key)}::${String((r as any).engine_version)}`;
      const arr = stateByEngine.get(k) ?? [];
      arr.push(r);
      stateByEngine.set(k, arr);
    }

    // Collect trade aggregates per engine keyed by day.
    const tradeAggByEngineDay = new Map<string, Map<string, TradeAgg>>();

    // PRIMARY live trades (SWING only).
    const { data: liveTrades, error: liveTradesError } = await supabase
      .from('live_trades')
      .select('exit_timestamp, realized_pnl_dollars')
      .eq('strategy', 'SWING')
      .eq('engine_key', 'SWING')
      .gte('exit_timestamp', `${since}T00:00:00.000Z`)
      .not('exit_timestamp', 'is', null);

    if (liveTradesError) {
      return NextResponse.json({ error: 'Failed to load live trades' }, { status: 500 });
    }

    const liveAgg = new Map<string, TradeAgg>();
    for (const t of liveTrades ?? []) {
      const day = normalizeDayKey((t as any).exit_timestamp);
      const pnl = Number((t as any).realized_pnl_dollars ?? 0);
      addAgg(liveAgg, day, pnl);
    }
    tradeAggByEngineDay.set('SWING::' + String(engines.find((e: any) => e.run_mode === 'PRIMARY' && e.engine_key === 'SWING')?.engine_version ?? ''), liveAgg);

    // SHADOW stock trades.
    const { data: engineTrades, error: engineTradesError } = await supabase
      .from('engine_trades')
      .select('engine_key, engine_version, run_mode, closed_at, realized_pnl')
      .eq('run_mode', 'SHADOW')
      .gte('closed_at', `${since}T00:00:00.000Z`);

    if (engineTradesError) {
      return NextResponse.json({ error: 'Failed to load engine trades' }, { status: 500 });
    }

    for (const t of engineTrades ?? []) {
      const ek = String((t as any).engine_key ?? '');
      const ev = String((t as any).engine_version ?? '');
      if (!ek || !ev) continue;
      const key = `${ek}::${ev}`;
      const day = normalizeDayKey((t as any).closed_at);
      const pnl = Number((t as any).realized_pnl ?? 0);
      const m = tradeAggByEngineDay.get(key) ?? new Map<string, TradeAgg>();
      addAgg(m, day, pnl);
      tradeAggByEngineDay.set(key, m);
    }

    // SHADOW crypto trades (pnl is per execution).
    const { data: cryptoTrades, error: cryptoTradesError } = await supabase
      .from('engine_crypto_trades')
      .select('engine_key, version, executed_at, pnl')
      .gte('executed_at', `${since}T00:00:00.000Z`);

    if (cryptoTradesError) {
      // Crypto tables may not exist in all envs; don't fail the entire endpoint.
      // (Fail-open for crypto stats only.)
    } else {
      for (const t of cryptoTrades ?? []) {
        const ek = String((t as any).engine_key ?? '');
        const ev = String((t as any).version ?? '');
        if (!ek || !ev) continue;
        const key = `${ek}::${ev}`;
        const day = normalizeDayKey((t as any).executed_at);
        const pnl = Number((t as any).pnl ?? 0);
        const m = tradeAggByEngineDay.get(key) ?? new Map<string, TradeAgg>();
        addAgg(m, day, pnl);
        tradeAggByEngineDay.set(key, m);
      }
    }

    const items: EngineDailySeries[] = [];

    for (const e of engines) {
      const key = `${e.engine_key}::${e.engine_version}`;
      const states = stateByEngine.get(key) ?? [];
      if (states.length === 0) {
        items.push({
          engine_key: e.engine_key,
          engine_version: e.engine_version,
          run_mode: e.run_mode,
          display_label: e.display_label,
          days: [],
        });
        continue;
      }

      // Compute daily equity curve + drawdown from daily_pnl.
      let equity = STARTING_EQUITY;
      let peak = STARTING_EQUITY;

      const aggByDay = tradeAggByEngineDay.get(key) ?? new Map<string, TradeAgg>();

      const daysOut: DailyRow[] = [];
      for (const s of states) {
        const day = normalizeDayKey((s as any).trading_day);
        const dailyPnl = Number((s as any).daily_pnl ?? 0);
        const tradesCount = Number((s as any).trades_count ?? 0);
        const state = String((s as any).state ?? '');
        const throttle = Number((s as any).throttle_factor ?? 1);
        const halt = ((s as any).halt_reason ?? null) as string | null;

        equity += dailyPnl;
        if (equity > peak) peak = equity;
        const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

        const agg = aggByDay.get(day) ?? { winners: 0, losers: 0 };
        const denom = agg.winners + agg.losers;
        const winRate = denom > 0 ? (agg.winners / denom) * 100 : null;

        daysOut.push({
          trading_day: day,
          daily_pnl: dailyPnl,
          trades_count: tradesCount,
          state,
          throttle_factor: throttle,
          halt_reason: halt,
          winners: agg.winners,
          losers: agg.losers,
          win_rate: winRate,
          equity,
          drawdown_pct: drawdownPct,
        });
      }

      items.push({
        engine_key: e.engine_key,
        engine_version: e.engine_version,
        run_mode: e.run_mode,
        display_label: e.display_label,
        days: daysOut,
      });
    }

    return NextResponse.json({ items, since }, { status: 200 });
  } catch (err) {
    console.error('[admin/engine-daily-metrics] unexpected error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
