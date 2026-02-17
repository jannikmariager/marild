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

interface Row {
  version: string;
  ticker: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
}

export async function GET(_req: NextRequest) {
  const { client: supabase, error } = getSupabaseOrError();
  if (error) return error;

  const { data, error: queryError } = await supabase
    .from('engine_comparison_results')
    .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
    .range(0, 99999);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
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
