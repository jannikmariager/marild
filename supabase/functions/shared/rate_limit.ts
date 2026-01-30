/**
 * In-memory rate limiting
 * Tracks requests per IP with sliding window
 * 
 * Feature Flags:
 * - FEATURE_RATE_LIMITING: Enables violation logging
 * - FEATURE_IP_BANS: Enables IP ban checking
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 30, windowMinutes: number = 1) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMinutes * 60 * 1000;
    
    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if request is allowed
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now > entry.resetAt) {
      // New window or expired - reset
      this.limits.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      // Rate limit exceeded
      return false;
    }

    // Increment count
    entry.count++;
    return true;
  }

  /**
   * Get remaining requests for a key
   */
  getRemaining(key: string): number {
    const entry = this.limits.get(key);
    if (!entry) {
      return this.maxRequests;
    }
    return Math.max(0, this.maxRequests - entry.count);
  }

  /**
   * Get seconds until reset
   */
  getResetSeconds(key: string): number {
    const entry = this.limits.get(key);
    if (!entry) {
      return 0;
    }
    return Math.max(0, Math.ceil((entry.resetAt - Date.now()) / 1000));
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now > entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }
}

/**
 * Extract client identifier from request
 */
export function getClientKey(req: Request): string {
  // Try to get IP from various headers
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0] || realIp || 'unknown';
  
  return `ip:${ip}`;
}

/**
 * Create rate limit error response
 */
export function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      message: 'Too many requests',
      retry_after_seconds: retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': retryAfter.toString(),
      },
    }
  );
}

// Global rate limiter instances
export const quoteLimiter = new RateLimiter(30, 1);  // 30 req/min
export const chartLimiter = new RateLimiter(30, 1);
export const metadataLimiter = new RateLimiter(30, 1);
export const trendingLimiter = new RateLimiter(30, 1);
export const globalLimiter = new RateLimiter(100, 1); // 100 req/min global

/**
 * Feature flag checks
 */
function isRateLimitingEnabled(): boolean {
  return Deno.env.get('FEATURE_RATE_LIMITING') === 'true';
}

function isIpBansEnabled(): boolean {
  return Deno.env.get('FEATURE_IP_BANS') === 'true';
}

/**
 * Log rate limit violation to database
 * Feature Flag: FEATURE_RATE_LIMITING
 */
export async function logRateLimitViolation(
  supabase: SupabaseClient,
  req: Request,
  userId: string | null,
  violationType: string
): Promise<void> {
  if (!isRateLimitingEnabled()) {
    // SAFETY: No-op if feature flag is off
    return;
  }
  
  const ip = getClientKey(req).replace('ip:', '');
  
  try {
    await supabase.from('rate_limit_logs').insert({
      ip_address: ip,
      user_id: userId,
      endpoint: new URL(req.url).pathname,
      violation_type: violationType,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[rate_limit] Failed to log violation:', error);
    // Don't throw - logging failure shouldn't block request
  }
}

/**
 * Check if IP is banned
 * Feature Flag: FEATURE_IP_BANS
 */
export async function isIpBanned(
  supabase: SupabaseClient,
  req: Request
): Promise<boolean> {
  if (!isIpBansEnabled()) {
    // SAFETY: Always allow if feature flag is off
    return false;
  }
  
  const ip = getClientKey(req).replace('ip:', '');
  
  try {
    const { data, error } = await supabase
      .from('ip_bans')
      .select('banned_until')
      .eq('ip_address', ip)
      .gt('banned_until', new Date().toISOString())
      .maybeSingle();
    
    if (error) {
      console.error('[rate_limit] Failed to check ban:', error);
      return false; // Fail open on errors
    }
    
    return !!data;
  } catch (error) {
    console.error('[rate_limit] Exception checking ban:', error);
    return false; // Fail open on errors
  }
}
