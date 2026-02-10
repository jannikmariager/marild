import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) return { error: 'Server not configured', client: null };
  return { error: null, client: createClient(url, serviceKey) };
}

interface Row {
  version: string;
  ticker: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
}

export async function GET() {
  const { error: envError, client } = getSupabaseAdmin();
  if (envError || !client) {
    return NextResponse.json({ error: envError }, { status: 500 });
  }

  const { data, error } = await client
    .from('engine_comparison_results')
    .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
    .range(0, 99999);

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