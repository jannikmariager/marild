import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// TODO(admin-v2): Revenue metrics require authoritative Stripe sync tables in Supabase.
// Until table names/schemas are confirmed, do not guess and do not call Stripe API.
// This endpoint returns a stable JSON shape with nullable metrics.

export async function GET(request: NextRequest) {
  const adminCtx = await requireAdmin(request);
  if (adminCtx instanceof NextResponse) return adminCtx;

  return NextResponse.json(
    {
      mrr: null,
      arr: null,
      active_subscriptions: null,
      failed_payments: null,
      mrr_history: [],
      source: 'unavailable',
    },
    { status: 200 },
  );
}
