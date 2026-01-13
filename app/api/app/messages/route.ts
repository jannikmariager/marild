'use server';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(searchParams: URLSearchParams): number {
  const raw = searchParams.get('limit');
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const before = searchParams.get('before');
    const limit = parseLimit(searchParams);

    // Determine audience filter based on entitlement
    let audienceFilters: string[] = ['all'];
    if (user) {
      // For now, treat all logged-in users as eligible for pro_only content.
      // If you need stricter gating, mirror subscription_status logic from live-portfolio.
      audienceFilters = ['all', 'pro_only'];
    }

    let query = supabase
      .from('app_messages')
      .select('*')
      .eq('is_published', true)
      .in('audience', audienceFilters)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq('type', type);
    }
    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[app/messages] query error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch (err) {
    console.error('[app/messages] unexpected error', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
