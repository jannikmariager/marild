import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/app/api/_lib/entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function GET(request: NextRequest) {
  try {
    const { id: userId } = await getUserFromRequest(request);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Server not configured' }, { status: 500 });
    }

    const supabase = createServiceClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();

    // Upsert state row and increment login_count.
    const { data: existing, error: selectError } = await supabase
      .from('user_attribution_state')
      .select('user_id, login_count, dismissed_until')
      .eq('user_id', userId)
      .maybeSingle();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error('[attribution/status] select error', selectError);
    }

    const nextLoginCount = (existing?.login_count ?? 0) + 1;

    const { data: upserted, error: upsertError } = await supabase
      .from('user_attribution_state')
      .upsert(
        {
          user_id: userId,
          login_count: nextLoginCount,
          dismissed_until: existing?.dismissed_until ?? null,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      )
      .select('login_count, dismissed_until')
      .maybeSingle();

    if (upsertError) {
      console.error('[attribution/status] upsert error', upsertError);
      return json({ error: 'Failed to update attribution state' }, { status: 500 });
    }

    const { data: attribution, error: attributionError } = await supabase
      .from('user_attributions')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (attributionError && attributionError.code !== 'PGRST116') {
      console.error('[attribution/status] attribution error', attributionError);
    }

    const hasAttribution = !!attribution?.id;

    return json({
      hasAttribution,
      loginCount: upserted?.login_count ?? nextLoginCount,
      dismissedUntil: upserted?.dismissed_until ?? null,
    });
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    if (respOrErr && typeof respOrErr === 'object' && 'status' in respOrErr) {
      return respOrErr as NextResponse;
    }
    console.error('[attribution/status] unexpected error', respOrErr);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
