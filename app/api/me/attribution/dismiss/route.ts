import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/app/api/_lib/entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export async function POST(request: NextRequest) {
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

    const now = new Date();
    const dismissedUntilDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const dismissedUntilIso = dismissedUntilDate.toISOString();

    const { data, error } = await supabase
      .from('user_attribution_state')
      .upsert(
        {
          user_id: userId,
          dismissed_until: dismissedUntilIso,
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('dismissed_until')
      .maybeSingle();

    if (error) {
      console.error('[attribution/dismiss] upsert error', error);
      return json({ error: 'Failed to update dismissal' }, { status: 500 });
    }

    return json({ ok: true, dismissedUntil: data?.dismissed_until ?? dismissedUntilIso });
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    if (respOrErr && typeof respOrErr === 'object' && 'status' in respOrErr) {
      return respOrErr as NextResponse;
    }
    console.error('[attribution/dismiss] unexpected error', respOrErr);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
