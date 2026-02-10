import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    return { error: 'Server not configured', client: null };
  }
  return { error: null, client: createClient(url, serviceKey) };
}

export async function GET(req: Request) {
  const { error, client } = getSupabaseAdmin();
  if (error || !client) {
    return NextResponse.json({ error }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') ?? 'csv';

  const { data, error: queryError } = await client
    .from('engine_comparison_results')
    .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
    .range(0, 99999);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
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
