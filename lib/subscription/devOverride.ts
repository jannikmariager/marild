/**
 * Development Subscription Override for Next.js
 * 
 * Provides devForcePro flag for testing PRO features without payment.
 * NEVER affects production builds (safe by design).
 * 
 * Usage in .env.local:
 * NEXT_PUBLIC_DEV_FORCE_PRO=true
 */

export interface DevSubscriptionStatus {
  tier: 'free' | 'pro' | 'expired';
  isPro: boolean;
  isExpired: boolean;
  forced?: boolean; // True if DEV override is active
}

/**
 * Check if DEV mode PRO override is enabled
 * Only works in non-production environments
 * 
 * @returns true if DEV_FORCE_PRO is enabled and not in production
 */
export function devForcePro(): boolean {
  const isDev = process.env.NODE_ENV !== 'production';
  const forceEnabled = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';
  
  return isDev && forceEnabled;
}


/**
 * Get dev mode subscription status
 * Returns a mock PRO status when DEV override is active
 * 
 * @returns DevSubscriptionStatus or null if DEV mode is not active
 */
export function getDevSubscriptionStatus(): DevSubscriptionStatus | null {
  if (!devForcePro()) {
    return null;
  }


  return {
    tier: 'pro',
    isPro: true,
    isExpired: false,
    forced: true,
  };
}

/**
 * Get dev mode label for UI debugging
 * Shows "PRO (DEV MODE)" or "TRIAL (DEV MODE)" badge
 * 
 * @returns Debug label string or null if not in dev mode
 */
export function getDevModeLabel(): string | null {
  if (!devForcePro()) {
    return null;
  }
  return 'PRO (DEV MODE)';
}

/**
 * Log dev configuration to console
 * Only logs if DEV mode is active (to avoid noise)
 */
export function logDevConfig(): void {
  if (!devForcePro()) {
    return;
  }

  console.log('╔════════════════════════════════════╗');
  console.log('║   TradeLens DEV Configuration      ║');
  console.log('╠════════════════════════════════════╣');
  console.log(`║ NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`║ DEV_FORCE_PRO: ${process.env.NEXT_PUBLIC_DEV_FORCE_PRO}`);
  console.log(`║ devForcePro(): ${devForcePro()}`);
  console.log('╚════════════════════════════════════╝');
}

/**
 * Wrap a subscription tier check with DEV override
 * Use this in components/API routes to check subscription
 * 
 * @param actualTier - The real subscription tier from database
 * @returns The effective tier (DEV override or actual)
 */
export function getEffectiveTier(
  actualTier: 'free' | 'pro' | 'expired'
): 'free' | 'pro' | 'expired' {
  const devStatus = getDevSubscriptionStatus();
  
  if (devStatus) {
    return devStatus.tier;
  }

  return actualTier;
}

/**
 * Check if user has PRO access (with DEV override support)
 * 
 * @param isPro - Actual PRO status from database
 * @returns True if user has PRO access (or DEV override is active)
 */
export function hasProAccess(isPro: boolean): boolean {
  if (devForcePro()) {
    return true;
  }
  return isPro;
}
