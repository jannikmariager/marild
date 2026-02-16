import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ ok: true, role: 'admin' }, { status: 200 });
}
