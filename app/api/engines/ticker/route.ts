import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) return { error: 'Server not configured', client: null };
  return { error: null, client: createClient(url, serviceKey) };
}

export async function GET(req: Request) {
  const { error: envError, client } = getSupabaseAdmin();
  if (envError || !client) {
    return NextResponse.json({ error: envError }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }
  const { data, error } = await client
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