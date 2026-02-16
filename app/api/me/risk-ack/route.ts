import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/app/api/_lib/entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function POST(request: NextRequest) {
  try {
    const { id: userId, email } = await getUserFromRequest(request);

    const body = await request.json().catch(() => ({}));
    const versionRaw = body?.risk_version;
    const risk_version = typeof versionRaw === 'number' && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : null;

    if (!risk_version || risk_version < 1) {
      return json({ error: 'Invalid risk_version' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Server not configured' }, { status: 500 });
    }

    const supabase = createServiceClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from('user_profile')
      .upsert(
        {
          user_id: userId,
          email,
          risk_acknowledged_at: nowIso,
          risk_version,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      );

    if (error) {
      return json({ error: 'Failed to store acknowledgement' }, { status: 500 });
    }

    return json({ ok: true });
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) {
      return respOrErr;
    }
    if (respOrErr && typeof respOrErr === 'object' && 'status' in respOrErr) {
      return respOrErr as NextResponse;
    }
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
