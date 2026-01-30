/**
 * Shared Subscription Checker
 * 
 * Centralized subscription status checker with DEV_FORCE_PRO support.
 * Use this in all Edge Functions that need subscription gating.
 * 
 * Features:
 * - DEV mode override (never affects production)
 * - Real-time trial expiration check
 * - Consistent subscription status across all functions
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

export interface SubscriptionStatus {
  tier: 'trial' | 'pro' | 'expired';
  isPro: boolean;
  isTrial: boolean;
  isExpired: boolean;
  trialEndsAt?: string | null;
  trialDaysRemaining?: number | null;
  forced?: boolean; // True if DEV override is active
}

/**
 * Get user's subscription status with DEV mode support
 * 
 * @param userId - User ID from JWT
 * @param supabaseUrl - Supabase project URL
 * @param supabaseKey - Supabase service role key
 * @returns Subscription status object
 */
export async function getUserSubscriptionStatus(
  userId: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<SubscriptionStatus> {
  // DEV MODE OVERRIDE - Never affects production
  const devForcePro = Deno.env.get('DEV_FORCE_PRO') === 'true';
  const isProduction = Deno.env.get('DENO_ENV') === 'production';
  const devForceTrialView = Deno.env.get('DEV_FORCE_TRIAL_VIEW') === 'true';

  if (!isProduction && devForcePro) {
    console.log('[DEV MODE] Forcing PRO subscription for development');
    return {
      tier: 'pro',
      isPro: true,
      isTrial: devForceTrialView, // Can test trial UI with PRO access
      isExpired: false,
      trialDaysRemaining: devForceTrialView ? 2 : null,
      forced: true,
    };
  }

  // PRODUCTION MODE - Real database check
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: user, error } = await supabase
      .from('user_profile')
      .select('subscription_tier, trial_ends_at')
      .eq('user_id', userId)
      .single();

    if (error || !user) {
      console.error('[SubscriptionChecker] Error fetching user:', error);
      // Default to expired if user not found (safe default)
      return {
        tier: 'expired',
        isPro: false,
        isTrial: false,
        isExpired: true,
      };
    }

    const now = new Date();
    const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const trialEnded = trialEndsAt && now > trialEndsAt;

    // Calculate days remaining for active trials
    let trialDaysRemaining: number | null = null;
    if (user.subscription_tier === 'trial' && trialEndsAt && !trialEnded) {
      const msRemaining = trialEndsAt.getTime() - now.getTime();
      trialDaysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    }

    // Determine actual tier (handle expired trials)
    const actualTier = trialEnded && user.subscription_tier === 'trial' 
      ? 'expired' 
      : user.subscription_tier as 'trial' | 'pro' | 'expired';

    return {
      tier: actualTier,
      isPro: actualTier === 'pro',
      isTrial: actualTier === 'trial',
      isExpired: actualTier === 'expired',
      trialEndsAt: user.trial_ends_at,
      trialDaysRemaining,
    };
  } catch (error) {
    console.error('[SubscriptionChecker] Unexpected error:', error);
    // Fail closed - deny access on errors
    return {
      tier: 'expired',
      isPro: false,
      isTrial: false,
      isExpired: true,
    };
  }
}

/**
 * Check if user has access to PRO features
 * 
 * @param status - Subscription status from getUserSubscriptionStatus()
 * @returns True if user is PRO or on active trial
 */
export function hasProAccess(status: SubscriptionStatus): boolean {
  return status.isPro || status.isTrial;
}

/**
 * Create a locked response for expired/non-pro users
 * 
 * @param feature - Name of the feature being accessed
 * @param status - User's subscription status
 * @returns JSON response object
 */
export function createLockedResponse(feature: string, status: SubscriptionStatus) {
  return {
    locked: true,
    tier: status.tier,
    isPro: status.isPro,
    isTrial: status.isTrial,
    isExpired: status.isExpired,
    message: status.isExpired
      ? `Your trial has ended. Upgrade to PRO to access ${feature}.`
      : `${feature} is a PRO feature. Start your 3-day trial to unlock it.`,
    upsell: {
      title: status.isExpired ? 'Upgrade to PRO' : 'Start Your Free Trial',
      description: status.isExpired
        ? 'Get unlimited access to all AI-powered trading insights.'
        : 'Get 3 days of full PRO access, no credit card required.',
      ctaText: status.isExpired ? 'Upgrade Now' : 'Start Trial',
      ctaUrl: '/account', // Redirect to account/billing page
    },
  };
}

/**
 * Helper to get subscription status from request
 * Extracts user ID from JWT and fetches status
 * 
 * @param req - Request object with Authorization header
 * @param supabaseUrl - Supabase project URL
 * @param supabaseKey - Supabase service role key
 * @returns Subscription status or null if unauthorized
 */
export async function getSubscriptionStatusFromRequest(
  req: Request,
  supabaseUrl: string,
  supabaseKey: string
): Promise<SubscriptionStatus | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return null;
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }

    return await getUserSubscriptionStatus(user.id, supabaseUrl, supabaseKey);
  } catch (error) {
    console.error('[SubscriptionChecker] Auth error:', error);
    return null;
  }
}

/**
 * Check daily usage limits for free-tier users
 * Feature Flag: FEATURE_FREE_TIER_LIMITS (default: false)
 * 
 * @param userId - User ID
 * @param supabase - Supabase client
 * @param actionType - Type of action: 'signal', 'smc', or 'chat'
 * @returns Usage check result with allowed status and remaining count
 */
export async function checkDailyUsage(
  userId: string,
  supabase: SupabaseClient,
  actionType: 'signal' | 'smc' | 'chat'
): Promise<{ allowed: boolean; remaining: number; limit: number; used: number }> {
  const isEnabled = Deno.env.get('FEATURE_FREE_TIER_LIMITS') === 'true';
  
  if (!isEnabled) {
    // SAFETY: Feature disabled - allow unlimited
    return { allowed: true, remaining: -1, limit: -1, used: 0 };
  }

  try {
    // Get subscription status
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const status = await getUserSubscriptionStatus(userId, supabaseUrl, supabaseKey);
    
    // Pro/Trial users: unlimited
    if (status.isPro || status.isTrial) {
      return { allowed: true, remaining: -1, limit: -1, used: 0 };
    }
    
    // Free users: check daily cap
    const today = new Date().toISOString().split('T')[0];
    
    const { data: usage } = await supabase
      .from('user_daily_usage')
      .select('*')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();
    
    const fieldName = `${actionType}_requests`;
    const currentCount = usage?.[fieldName] || 0;
    
    // Define limits per action type
    const limits = {
      signal: 10,
      smc: 5,
      chat: 20
    };
    const limit = limits[actionType];
    
    if (currentCount >= limit) {
      return { allowed: false, remaining: 0, limit, used: currentCount };
    }
    
    // Increment counter atomically
    await supabase.from('user_daily_usage').upsert({
      user_id: userId,
      usage_date: today,
      [fieldName]: currentCount + 1
    }, { 
      onConflict: 'user_id,usage_date',
      ignoreDuplicates: false 
    });
    
    return { allowed: true, remaining: limit - currentCount - 1, limit, used: currentCount + 1 };
  } catch (error) {
    console.error('[checkDailyUsage] Error:', error);
    // Fail open on errors (allow request)
    return { allowed: true, remaining: -1, limit: -1, used: 0 };
  }
}
