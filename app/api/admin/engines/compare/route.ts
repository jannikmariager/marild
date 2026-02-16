import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Row {
  version: string;
  ticker: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
}

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

  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get('timeframe'); // e.g. "day" | "swing" | "invest"

  let query = supabase
    .from('engine_comparison_results')
    .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
    .range(0, 99999);

  if (timeframe) {
    query = query.eq('timeframe', timeframe);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tickerSet = new Set<string>();
  const versionSet = new Set<string>();
  const matrix: Record<string, Record<string, any>> = {};

  for (const row of (data ?? []) as Row[]) {
    tickerSet.add(row.ticker);
    versionSet.add(row.version);
    if (!matrix[row.ticker]) matrix[row.ticker] = {};
    matrix[row.ticker][row.version] = {
      pnl: row.pnl,
      win_rate: row.win_rate,
      max_dd: row.max_dd,
      avg_r: row.avg_r,
    };
  }

  return NextResponse.json({
    tickers: Array.from(tickerSet).sort(),
    versions: Array.from(versionSet).sort(),
    matrix,
  });
}
