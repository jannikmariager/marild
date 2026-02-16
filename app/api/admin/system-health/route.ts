import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  let jobs: any = null;
  let bars_1m: any = null;
  let heartbeat: any = null;

  try {
    const { data, error } = await supabase
      .from('job_run_log')
      .select('job_name, started_at, finished_at, ok, error')
      .order('started_at', { ascending: false })
      .limit(100);

    if (!error) {
      const latestByJob: Record<string, any> = {};
      for (const row of data ?? []) {
        if (!row?.job_name) continue;
        if (!latestByJob[row.job_name]) {
          latestByJob[row.job_name] = row;
        }
      }
      jobs = { latest_by_job: latestByJob, recent: data ?? [] };
    }
  } catch {
    jobs = null;
  }

  try {
    const { data, error } = await supabase
      .from('bars_1m')
      .select('symbol, ts')
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error) {
      const latestTs = data?.ts ?? null;
      const age_seconds = latestTs ? Math.floor((Date.now() - new Date(latestTs).getTime()) / 1000) : null;
      bars_1m = { latest_ts: latestTs, age_seconds };
    }
  } catch {
    bars_1m = null;
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const hbResp = await fetch(`${url}/functions/v1/system_heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });

      heartbeat = hbResp.ok ? await hbResp.json() : { ok: false, error: `Heartbeat HTTP ${hbResp.status}` };
    }
  } catch {
    heartbeat = null;
  }

  return NextResponse.json(
    {
      cron: jobs,
      bars_1m,
      engine_heartbeat: heartbeat,
      alpaca: { status: 'unknown' },
    },
    { status: 200 },
  );
}
