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
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  const { data, error: queryError } = await supabase
    .from('engine_comparison_results')
    .select('version,timeframe,pnl,win_rate,max_dd,avg_r,trades')
    .eq('ticker', symbol.toUpperCase());

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
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