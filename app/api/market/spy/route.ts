import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type SpyPoint = { date: string; close: number };

type ChartResponse = {
  timestamps?: number[];
  closes?: number[];
};

const toDateKeyUtc = (ms: number): string => {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const pickRange = (diffDays: number): '6mo' | '1y' | '2y' | '5y' | 'max' => {
  if (diffDays <= 180) return '6mo';
  if (diffDays <= 365) return '1y';
  if (diffDays <= 730) return '2y';
  if (diffDays <= 1825) return '5y';
  return 'max';
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'SERVER_NOT_CONFIGURED' }, { status: 500 });
    }

    let range: '6mo' | '1y' | '2y' | '5y' | 'max' = '6mo';
    if (start || end) {
      const startMs = start ? new Date(`${start}T00:00:00.000Z`).getTime() : null;
      const endMs = end ? new Date(`${end}T00:00:00.000Z`).getTime() : null;
      const from = Number.isFinite(startMs as number) ? (startMs as number) : null;
      const to = Number.isFinite(endMs as number) ? (endMs as number) : null;
      if (from != null && to != null && to >= from) {
        const diffDays = Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24)));
        range = pickRange(diffDays);
      } else {
        range = 'max';
      }
    }

    const resp = await fetch(`${supabaseUrl}/functions/v1/get_chart_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ ticker: 'SPY', range, interval: '1d' }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[market/spy] get_chart_v2 failed', resp.status, body);
      return NextResponse.json({ error: 'UPSTREAM_ERROR' }, { status: 502 });
    }

    const chart = (await resp.json().catch(() => null)) as ChartResponse | null;
    const timestamps = Array.isArray(chart?.timestamps) ? chart!.timestamps! : [];
    const closes = Array.isArray(chart?.closes) ? chart!.closes! : [];

    const points: SpyPoint[] = [];
    for (let i = 0; i < Math.min(timestamps.length, closes.length); i += 1) {
      const ts = timestamps[i];
      const close = closes[i];
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if (typeof close !== 'number' || !Number.isFinite(close)) continue;
      const ms = ts * 1000;
      const date = toDateKeyUtc(ms);
      points.push({ date, close });
    }

    // Optional filter by start/end (inclusive) after normalization.
    const startKey = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;
    const endKey = end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;

    const filtered = points
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .filter((p) => {
        if (startKey && p.date < startKey) return false;
        if (endKey && p.date > endKey) return false;
        return true;
      });

    return NextResponse.json(
      { ticker: 'SPY', points: filtered },
      {
        status: 200,
        headers: {
          // Cache safely at the edge.
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        },
      },
    );
  } catch (error) {
    console.error('[market/spy] unexpected error', error);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
