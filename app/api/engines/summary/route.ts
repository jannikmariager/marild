import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { error: "Server not configured", client: null };
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

type Style = "DAYTRADER" | "SWING" | "INVESTOR";

function styleForTimeframe(tfRaw: string): Style {
  const tf = tfRaw.toLowerCase();
  if (["1m", "3m", "5m", "15m", "30m"].includes(tf)) return "DAYTRADER";
  if (["1h", "2h", "4h"].includes(tf)) return "SWING";
  return "INVESTOR";
}

export async function GET() {
  const { error: envError, client } = getSupabaseAdmin();
  if (envError || !client) {
    return NextResponse.json({ error: envError }, { status: 500 });
  }
  // Fetch per-timeframe to avoid hitting PostgREST's 1k row cap
  const tfs = ['day', 'swing', 'invest'];
  const rows: Row[] = [] as any;

  for (const tf of tfs) {
    const { data, error } = await client
      .from('engine_comparison_results')
      .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r')
      .eq('timeframe', tf)
      .range(0, 9999);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data) rows.push(...(data as Row[]));
  }

  const versionSet = new Set<string>();
  const styles: Style[] = ["DAYTRADER", "SWING", "INVESTOR"];

  // summary[style][version]
  const summary: Record<Style, Record<string, {
    symbol_count: number;
    profitable_count: number; // avg_r > 0
    avg_avg_r: number;        // mean of avg_r
    avg_win_rate: number;     // mean win_rate
  }>> = {
    DAYTRADER: {},
    SWING: {},
    INVESTOR: {},
  };

  // intermediate accumulators
  const acc: Record<Style, Record<string, { n: number; n_prof: number; sum_r: number; sum_win: number }>> = {
    DAYTRADER: {},
    SWING: {},
    INVESTOR: {},
  };

  for (const row of rows) {
    const version = row.version;
    const style = styleForTimeframe(row.timeframe);
    versionSet.add(version);

    if (!acc[style][version]) {
      acc[style][version] = { n: 0, n_prof: 0, sum_r: 0, sum_win: 0 };
    }

    const a = acc[style][version];
    a.n += 1;

    const avg_r = row.avg_r ?? 0;
    const win = row.win_rate ?? 0;
    a.sum_r += avg_r;
    a.sum_win += win;
    if (avg_r > 0) a.n_prof += 1;
  }

  for (const style of styles) {
    summary[style] = {};
    for (const [version, a] of Object.entries(acc[style])) {
      summary[style][version] = {
        symbol_count: a.n,
        profitable_count: a.n_prof,
        avg_avg_r: a.n > 0 ? a.sum_r / a.n : 0,
        avg_win_rate: a.n > 0 ? a.sum_win / a.n : 0,
      };
    }
  }

  return NextResponse.json({
    versions: Array.from(versionSet).sort(),
    styles,
    summary,
    // expose raw rows for detailed lists if the UI needs them later
    rows,
  });
}