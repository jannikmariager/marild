import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Row {
  version: string;
  ticker: string;
  timeframe: string;
  pnl: number | null;
  win_rate: number | null;
  max_dd: number | null;
  avg_r: number | null;
  trades_total: number | null;
}

type Style = 'DAYTRADER' | 'SWING' | 'INVESTOR';

function styleForTimeframe(tfRaw: string): Style {
  const tf = tfRaw.toLowerCase();
  if (tf === 'day' || tf === 'daytrader') return 'DAYTRADER';
  if (tf === 'swing' || tf === 'swingtrader') return 'SWING';
  return 'INVESTOR';
}

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow();
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  // Fetch per-timeframe to avoid hitting PostgREST's 1k row cap for a single query
  const tfs = ['day', 'swing', 'invest'];
  // Prefer newer modular engines in the summary; still include older ones for history.
  const targetVersions = ['V6.0', 'V5.0', 'V4.9', 'V4.8', 'V5.1', 'V4.6', 'V4.7'];
  const rows: Row[] = [] as any;

  for (const tf of tfs) {
    const { data, error } = await supabase
      .from('engine_comparison_results')
      .select('version,ticker,timeframe,pnl,win_rate,max_dd,avg_r,trades_total')
      .eq('timeframe', tf)
      .in('version', targetVersions)
      .order('version', { ascending: true })
      .order('ticker', { ascending: true })
      .range(0, 9999);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data) rows.push(...(data as Row[]));
  }

  const versionSet = new Set<string>();
  const styles: Style[] = ['DAYTRADER', 'SWING', 'INVESTOR'];

  const summary: Record<Style, Record<string, {
    symbol_count: number;
    profitable_count: number;
    avg_avg_r: number;
    avg_win_rate: number;
  }>> = {
    DAYTRADER: {},
    SWING: {},
    INVESTOR: {},
  };

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
    rows,
  });
}
