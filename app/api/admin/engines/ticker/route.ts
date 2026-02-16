import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

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

  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('engine_comparison_results')
    .select('version,timeframe,pnl,win_rate,max_dd,avg_r,trades')
    .eq('ticker', symbol.toUpperCase());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = (data ?? []).map((row: any) => {
    const tradesJson = row.trades || {};
    const tradesArr = tradesJson.trades as unknown[] | undefined;
    return {
      version: row.version,
      timeframe: row.timeframe,
      pnl: row.pnl,
      win_rate: row.win_rate,
      max_dd: row.max_dd,
      avg_r: row.avg_r,
      trades_count: Array.isArray(tradesArr) ? tradesArr.length : null,
    };
  });

  entries.sort((a: any, b: any) => {
    if (a.version === b.version) return a.timeframe.localeCompare(b.timeframe);
    return a.version.localeCompare(b.version);
  });

  return NextResponse.json({ ticker: symbol.toUpperCase(), entries });
}
