import { createClient } from './supabaseServer';
import { User } from '@/types/db';
import { devForcePro, getDevSubscriptionStatus } from './subscription/devOverride';

export async function getServerSession() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    console.error('Error getting user:', error);
    return null;
  }
  
  return { user };
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return null;
  }

  const email_verified = !!user.email_confirmed_at;
  
  // Fetch user profile directly from user_profile table (public.users view was dropped)
  const { data: profile, error } = await supabase
    .from('user_profile')
    .select(
      `
        user_id,
        email,
        subscription_tier,
        country,
        preferences,
        risk_level,
        created_at,
        updated_at
      `
    )
    .eq('user_id', user.id)
    .maybeSingle(); // Allow missing profile rows without throwing
  
  if (error) {
    console.error('Error fetching user:', error);
    return null;
  }
  
  // If no user profile exists, return null (they need to complete signup)
  if (!profile) {
    return null;
  }
  
  return {
    id: profile.user_id,
    email: profile.email ?? user.email ?? '',
    subscription_tier: profile.subscription_tier as User['subscription_tier'],
    country: profile.country ?? undefined,
    preferred_markets: (profile.preferences as string[] | null) ?? undefined,
    risk_level: profile.risk_level ?? undefined,
    created_at: profile.created_at ?? undefined,
    updated_at: profile.updated_at ?? undefined,
    email_verified,
  };
}

export async function requireAuth() {
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('Unauthorized');
  }
  
  return user;
}

export function hasActiveSubscription(user: User | null): boolean {
  // DEV override
  if (devForcePro()) {
    return true;
  }
  return user?.subscription_tier === 'pro';
}

export function isProUser(user: User | null): boolean {
  // DEV override
  const devStatus = getDevSubscriptionStatus();
  if (devStatus) {
    return devStatus.isPro;
  }
  
  return user?.subscription_tier === 'pro';
}

export function isExpired(user: User | null): boolean {
  // DEV override never shows expired
  if (devForcePro()) {
    return false;
  }
  
  return user?.subscription_tier === 'expired';
}
