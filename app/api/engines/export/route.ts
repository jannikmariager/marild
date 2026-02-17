import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseOrError() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      client: null as any,
      error: NextResponse.json({ error: 'Server not configured' }, { status: 500 }) as NextResponse,
    };
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  return { client, error: null as NextResponse | null };
}

export async function GET(req: NextRequest) {
  const { client: supabase, error } = getSupabaseOrError();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') ?? 'csv';

  const { data, error: queryError } = await supabase
    .from('engine_comparison_results')
    .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
    .range(0, 99999);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (format === 'json') {
    // simple JSON of rows (used by RegressionHeatmap via trade-dashboard backend normally)
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