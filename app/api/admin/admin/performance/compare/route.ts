import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

type EquityPoint = { ts: string; equity: number };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    const [cryptoCurve, stockCurve] = await Promise.all([
      fetchCryptoCurve(supabase),
      fetchStockCurve(supabase),
    ]);

    const cryptoMetrics = computeMetrics(cryptoCurve, await fetchCryptoTrades(supabase));
    const stockMetrics = computeMetrics(stockCurve, await fetchStockTrades(supabase));
    const correlation = computeCorrelation(cryptoCurve, stockCurve);

    return NextResponse.json({
      crypto: { equity_curve: cryptoCurve, metrics: cryptoMetrics },
      stocks: { equity_curve: stockCurve, metrics: stockMetrics },
      correlation,
    });
  } catch (error: any) {
    console.error("[performance/compare] error", error);
    return NextResponse.json(
      { error: error?.message ?? "unknown error" },
      { status: 500 },
    );
  }
}

async function fetchCryptoCurve(supabase: ReturnType<typeof getAdminSupabaseOrThrow>): Promise<EquityPoint[]> {
  const { data, error } = await supabase
    .from("engine_crypto_portfolio_state")
    .select("ts,equity")
    .eq("engine_key", "CRYPTO_V1_SHADOW")
    .eq("version", "v1")
    .order("ts", { ascending: true });
  if (error || !data) return [];
  return data.map((r: any) => ({ ts: r.ts, equity: Number(r.equity) }));
}

async function fetchStockCurve(supabase: ReturnType<typeof getAdminSupabaseOrThrow>): Promise<EquityPoint[]> {
  // Use live_portfolio_state if available
  const { data, error } = await supabase
    .from("live_portfolio_state")
    .select("ts,equity_dollars")
    .order("ts", { ascending: true })
    .limit(1000);
  if (error || !data) return [];
  return data.map((r: any) => ({ ts: r.ts, equity: Number(r.equity_dollars) }));
}

async function fetchCryptoTrades(supabase: ReturnType<typeof getAdminSupabaseOrThrow>) {
  const { data, error } = await supabase
    .from("engine_crypto_trades")
    .select("pnl");
  if (error || !data) return [];
  return data.map((r: any) => Number(r.pnl || 0));
}

async function fetchStockTrades(supabase: ReturnType<typeof getAdminSupabaseOrThrow>) {
  const { data, error } = await supabase.from('live_trades').select('realized_pnl_dollars');
  if (error || !data) return [];
  return data.map((r: any) => Number(r.realized_pnl_dollars || 0));
}

function computeMetrics(curve: EquityPoint[], tradePnls: number[]) {
  if (!curve.length) {
    return {
      total_return_pct: 0,
      max_drawdown_pct: 0,
      sharpe: 0,
      win_rate: 0,
      profit_factor: 0,
      trades: 0,
    };
  }
  const first = curve[0].equity;
  const last = curve[curve.length - 1].equity;
  const total_return_pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const max_drawdown_pct = maxDrawdown(curve);
  const sharpe = sharpeRatio(curve);
  const wins = tradePnls.filter((p) => p > 0);
  const losses = tradePnls.filter((p) => p < 0);
  const win_rate = tradePnls.length ? wins.length / tradePnls.length : 0;
  const profit_factor =
    losses.reduce((s, v) => s + Math.abs(v), 0) === 0
      ? 0
      : wins.reduce((s, v) => s + v, 0) /
        losses.reduce((s, v) => s + Math.abs(v), 0);
  return {
    total_return_pct,
    max_drawdown_pct,
    sharpe,
    win_rate,
    profit_factor,
    trades: tradePnls.length,
  };
}

function maxDrawdown(curve: EquityPoint[]): number {
  let peak = curve[0].equity;
  let maxDd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    const dd = peak > 0 ? (peak - p.equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd * 100;
}

function sharpeRatio(curve: EquityPoint[]): number {
  if (curve.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity;
    const curr = curve[i].equity;
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  if (!returns.length) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  const dailySharpe = mean / std;
  return dailySharpe * Math.sqrt(365);
}

function computeCorrelation(a: EquityPoint[], b: EquityPoint[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  // use overlapping daily returns
  const mapA = new Map(a.map((p) => [p.ts.slice(0, 10), p.equity]));
  const mapB = new Map(b.map((p) => [p.ts.slice(0, 10), p.equity]));
  const dates = Array.from(mapA.keys()).filter((d) => mapB.has(d));
  if (dates.length < 2) return 0;
  const returnsA: number[] = [];
  const returnsB: number[] = [];
  dates.sort();
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    const eqA0 = mapA.get(prev)!;
    const eqA1 = mapA.get(curr)!;
    const eqB0 = mapB.get(prev)!;
    const eqB1 = mapB.get(curr)!;
    if (eqA0 > 0 && eqB0 > 0) {
      returnsA.push((eqA1 - eqA0) / eqA0);
      returnsB.push((eqB1 - eqB0) / eqB0);
    }
  }
  if (returnsA.length < 2) return 0;
  const meanA = returnsA.reduce((s, v) => s + v, 0) / returnsA.length;
  const meanB = returnsB.reduce((s, v) => s + v, 0) / returnsB.length;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < returnsA.length; i++) {
    const da = returnsA[i] - meanA;
    const db = returnsB[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  if (denomA === 0 || denomB === 0) return 0;
  return num / Math.sqrt(denomA * denomB);
}
