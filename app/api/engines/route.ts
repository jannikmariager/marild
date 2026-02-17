import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseOrError() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      client: null as any,
      error: NextResponse.json({ error: 'Server not configured' }, { status: 500 }) as NextResponse,
    };
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  return { client, error: null as NextResponse | null };
}

export async function GET(_req: NextRequest) {
  const { client: supabase, error } = getSupabaseOrError();
  if (error) return error;

  const { data, error: queryError } = await supabase
    .from('engine_versions')
    .select('id,version,created_at,notes,features,metrics,improvement_score')
    .order('created_at', { ascending: true });

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
