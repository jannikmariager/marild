import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/app/api/_lib/entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function GET(request: NextRequest) {
  try {
    const { id: userId, email } = await getUserFromRequest(request);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Server not configured' }, { status: 500 });
    }

    const supabase = createServiceClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: profile } = await supabase
      .from('user_profile')
      .select('display_name, risk_acknowledged_at, risk_version')
      .eq('user_id', userId)
      .maybeSingle();

    return json({
      user: { id: userId, email },
      profile: {
        display_name: profile?.display_name ?? null,
        risk_acknowledged_at: (profile as any)?.risk_acknowledged_at ?? null,
        risk_version: (profile as any)?.risk_version ?? 0,
      },
    });
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

export async function PATCH(request: NextRequest) {
  try {
    const { id: userId, email } = await getUserFromRequest(request);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Server not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const displayNameRaw = body?.display_name;
    const display_name = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : null;

    // Upsert by user_id.
    const supabase = createServiceClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('user_profile')
      .upsert(
        { user_id: userId, email, display_name, updated_at: nowIso },
        { onConflict: 'user_id' },
      )
      .select('display_name')
      .maybeSingle();

    if (error) {
      return json({ error: 'Failed to update profile' }, { status: 500 });
    }

    return json({
      user: { id: userId, email },
      profile: { display_name: updated?.display_name ?? null },
    });
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
