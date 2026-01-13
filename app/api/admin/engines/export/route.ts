import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
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
