import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

type AdminContext = {
  adminId: string;
  adminEmail: string | null;
};

const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

function getBearerToken(request: NextRequest): string | null {
  const raw = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return { client: null as any, error: json({ error: 'Server not configured' }, { status: 500 }) };
  }

  const client = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { client, error: null as NextResponse | null };
}

/**
 * requireAdmin
 * - Bearer token is mandatory for the Vite app.
 * - Validates token using Supabase Admin.
 * - Loads user_profile.role using service role.
 * - Returns 401/403 as JSON responses (never throws).
 */
export async function requireAdmin(request: NextRequest): Promise<AdminContext | NextResponse> {
  const token = getBearerToken(request);
  if (!token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { client: supabase, error: envErr } = getAdminSupabase();
  if (envErr) return envErr;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user?.id) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    // Fail closed.
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  if ((profile?.role || 'user') !== 'admin') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  return { adminId: user.id, adminEmail: user.email ?? null };
}

type LogAdminActionParams = {
  adminId: string;
  action: string;
  entity: string;
  before: unknown | null;
  after: unknown | null;
};

/**
 * logAdminAction
 * Best-effort audit log insert. Never throws.
 */
export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  const { adminId, action, entity, before, after } = params;

  const { client: supabase, error: envErr } = getAdminSupabase();
  if (envErr) {
    console.error('[admin_audit_log] env missing; skipping log', { action, entity });
    return;
  }

  try {
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      action,
      entity,
      before: before ?? null,
      after: after ?? null,
    });

    if (error) {
      console.error('[admin_audit_log] insert failed', { action, entity, error: error.message ?? error });
    }
  } catch (err) {
    console.error('[admin_audit_log] insert threw', { action, entity, err });
  }
}

export function requireAdminOrThrow(ctx: AdminContext | NextResponse): AdminContext {
  if (ctx instanceof NextResponse) {
    throw ctx;
  }
  return ctx;
}

export function getAdminSupabaseOrThrow(): ReturnType<typeof createServiceClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw json({ error: 'Server not configured' }, { status: 500 });
  }
  return createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
