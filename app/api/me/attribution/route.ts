import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/app/api/_lib/entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

const ALLOWED_SOURCES = [
  'x_twitter',
  'google_search',
  'tradingview',
  'discord',
  'youtube',
  'friend_referral',
  'reddit',
  'newsletter_podcast',
  'other',
] as const;

type AttributionSource = (typeof ALLOWED_SOURCES)[number];

interface SaveAttributionPayload {
  source: AttributionSource;
  details?: string | null;
}

function normalizePayload(raw: any): SaveAttributionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = String(raw.source ?? '').trim() as AttributionSource;
  if (!ALLOWED_SOURCES.includes(source)) return null;

  let details: string | null = null;
  if (source === 'other') {
    const d = typeof raw.details === 'string' ? raw.details.trim() : '';
    if (d.length < 2 || d.length > 80) {
      return null;
    }
    details = d;
  }

  return { source, details };
}

export async function POST(request: NextRequest) {
  try {
    const { id: userId, email } = await getUserFromRequest(request);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'Server not configured' }, { status: 500 });
    }

    const bodyRaw = await request.json().catch(() => null);
    const payload = normalizePayload(bodyRaw);
    if (!payload) {
      return json({ error: 'Invalid payload' }, { status: 400 });
    }

    const supabase = createServiceClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from('user_attributions')
      .upsert(
        {
          user_id: userId,
          source: payload.source,
          details: payload.details ?? null,
          updated_at: nowIso,
          // created_at handled by default on insert
        },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.error('[attribution] upsert failed for user', userId, email, error);
      return json({ error: 'Failed to save attribution' }, { status: 500 });
    }

    return json({ ok: true });
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    if (respOrErr && typeof respOrErr === 'object' && 'status' in respOrErr) {
      return respOrErr as NextResponse;
    }
    console.error('[attribution] unexpected error', respOrErr);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
