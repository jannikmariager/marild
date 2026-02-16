import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/_lib/admin';
import { createGa4ClientFromEnv, getGa4Env } from '@/app/api/_lib/ga4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SnapshotResponse = {
  visitors_7d: number | null;
  visitors_delta_pct: number | null;
  visitors_sparkline: number[] | null;
  signups_7d: number | null;
  signups_delta_pct: number | null;
  signups_sparkline: number[] | null;
  conversion_rate_pct: number | null;
  top_channel: string | null;
  top_channel_pct: number | null;
  connected: boolean;
  source?: string;
  error?: string;
};

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pctDelta = (prev: number, curr: number): number | null => {
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
  if (prev === 0) {
    if (curr === 0) return 0;
    return null;
  }
  return ((curr - prev) / prev) * 100;
};

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

  const env = getGa4Env();
  if (!env) {
    const resp: SnapshotResponse = {
      visitors_7d: null,
      visitors_delta_pct: null,
      visitors_sparkline: null,
      signups_7d: null,
      signups_delta_pct: null,
      signups_sparkline: null,
      conversion_rate_pct: null,
      top_channel: null,
      top_channel_pct: null,
      connected: false,
      source: 'unconfigured',
    };
    return json(resp, { status: 200 });
  }

  try {
    const client = createGa4ClientFromEnv(env);
    const property = `properties/${env.propertyId}`;

    // Visitors + signups, last 7 days vs previous 7 days.
    // Note: we intentionally run two separate reports to avoid ambiguity in metricValues ordering.
    const [curr] = await client.runReport({
      property,
      metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
    });

    const [prev] = await client.runReport({
      property,
      metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
      dateRanges: [{ startDate: '14daysAgo', endDate: '8daysAgo' }],
    });

    const currRow = curr.rows?.[0];
    const prevRow = prev.rows?.[0];

    const vCurr = num(currRow?.metricValues?.[0]?.value);
    const sCurr = num(currRow?.metricValues?.[1]?.value);
    const vPrev = num(prevRow?.metricValues?.[0]?.value);
    const sPrev = num(prevRow?.metricValues?.[1]?.value);

    // Sparklines for last 7 days (daily).
    const [visSeries] = await client.runReport({
      property,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }],
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const visitors_sparkline = (visSeries.rows ?? []).map((r) => num(r.metricValues?.[0]?.value));

    const [signSeries] = await client.runReport({
      property,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'newUsers' }],
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const signups_sparkline = (signSeries.rows ?? []).map((r) => num(r.metricValues?.[0]?.value));

    // Top channel (rough, but useful): sessionDefaultChannelGroup by activeUsers.
    const [channel] = await client.runReport({
      property,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'activeUsers' }],
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 1,
    });

    const topRow = channel.rows?.[0];
    const topChannel = topRow?.dimensionValues?.[0]?.value ?? null;
    const topChannelUsers = num(topRow?.metricValues?.[0]?.value);
    const topChannelPct = vCurr > 0 ? (topChannelUsers / vCurr) * 100 : null;

    const conversion_rate_pct = vCurr > 0 ? (sCurr / vCurr) * 100 : null;

    const resp: SnapshotResponse = {
      visitors_7d: vCurr,
      visitors_delta_pct: pctDelta(vPrev, vCurr),
      visitors_sparkline,
      signups_7d: sCurr,
      signups_delta_pct: pctDelta(sPrev, sCurr),
      signups_sparkline,
      conversion_rate_pct,
      top_channel: topChannel,
      top_channel_pct: topChannelPct,
      connected: true,
      source: 'ga4',
    };

    return json(resp, { status: 200 });
  } catch (err: any) {
    const resp: SnapshotResponse = {
      visitors_7d: null,
      visitors_delta_pct: null,
      visitors_sparkline: null,
      signups_7d: null,
      signups_delta_pct: null,
      signups_sparkline: null,
      conversion_rate_pct: null,
      top_channel: null,
      top_channel_pct: null,
      connected: false,
      source: 'error',
      error: err?.message ?? 'GA4 request failed',
    };

    return json(resp, { status: 200 });
  }
}
