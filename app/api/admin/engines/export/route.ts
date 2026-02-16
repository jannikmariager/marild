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
  const format = searchParams.get('format') ?? 'csv';

  const { data, error } = await supabase
    .from('engine_comparison_results')
    .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
    .range(0, 99999);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (format === 'json') {
    return NextResponse.json(data ?? []);
  }

  const rows = data ?? [];
  const header = ['ticker', 'version', 'timeframe', 'pnl', 'win_rate', 'max_dd', 'avg_r'];
  const lines = [header.join(',')];

  for (const row of rows as any[]) {
    lines.push([
      row.ticker,
      row.version,
      row.timeframe,
      row.pnl ?? '',
      row.win_rate ?? '',
      row.max_dd ?? '',
      row.avg_r ?? '',
    ].join(','));
  }

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/csv' },
  });
}
