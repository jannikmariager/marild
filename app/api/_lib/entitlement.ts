import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';

const getBearerToken = (request: NextRequest): string | null => {
  const raw = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export type Entitlement = {
  active: boolean;
  plan: 'pro' | 'free' | null;
  status: 'active' | 'inactive' | 'unauthenticated';
};

export type AuthUser = { id: string; email: string | null };

export async function getUserFromRequest(request: NextRequest): Promise<AuthUser> {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader) {
    throw NextResponse.json(
      { error: 'Missing Authorization header' },
      { status: 401 },
    );
  }

  // Prefer cookie session when available (Next app).
  const authClient = await createServerClient();
  const {
    data: { user: cookieUser },
  } = await authClient.auth.getUser();

  if (cookieUser?.id) {
    return { id: cookieUser.id, email: cookieUser.email ?? null };
  }

  const token = getBearerToken(request);
  if (!token) {
    throw NextResponse.json(
      { error: 'Missing Bearer token' },
      { status: 401 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const supabaseAdmin = createServiceClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);

  if (!user?.id) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { id: user.id, email: user.email ?? null };
}

export async function getUserIdFromRequest(request: NextRequest): Promise<string> {
  const user = await getUserFromRequest(request);
  return user.id;
}

export async function getEntitlementForUserId(userId: string): Promise<Entitlement> {
  // DEV override (env-based)
  if (hasProAccess(false)) {
    return { active: true, plan: 'pro', status: 'active' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { active: false, plan: null, status: 'inactive' };
  }

  const supabase = createServiceClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: profile, error } = await supabase
    .from('user_profile')
    .select('subscription_tier, premium_override_dev')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Fail closed.
    return { active: false, plan: null, status: 'inactive' };
  }

  const isPro = profile?.subscription_tier === 'pro';
  const override = profile?.premium_override_dev === true;
  const active = Boolean(isPro || override);

  return {
    active,
    plan: active ? 'pro' : 'free',
    status: active ? 'active' : 'inactive',
  };
}

export async function requireActiveEntitlement(request: NextRequest): Promise<{ userId: string; entitlement: Entitlement }> {
  const userId = await getUserIdFromRequest(request);
  const entitlement = await getEntitlementForUserId(userId);

  if (!entitlement.active) {
    throw NextResponse.json(
      { error: 'subscription_required', message: 'Active subscription required' },
      { status: 403 },
    );
  }

  return { userId, entitlement };
}
