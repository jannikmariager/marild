import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminSupabaseOrThrow } from '@/app/api/_lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;

  let supabase;
  try {
    supabase = getAdminSupabaseOrThrow() as any;
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) return respOrErr;
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('engine_versions')
    .select('id,version,created_at,notes,features,metrics,improvement_score')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to load engines' }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}
