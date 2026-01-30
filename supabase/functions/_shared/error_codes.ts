/**
 * Structured Error Codes System (Magnifi-style)
 * Feature Flag: FEATURE_ERROR_CODES (default: false)
 * 
 * Provides user-friendly error messages with retry guidance
 */

export enum ErrorCode {
  // AI/Provider Errors
  AI_TIMEOUT = 'AI_TIMEOUT',
  PROVIDER_DOWN = 'PROVIDER_DOWN',
  AI_RATE_LIMIT = 'AI_RATE_LIMIT',
  
  // Data Errors
  INVALID_TICKER = 'INVALID_TICKER',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  DATA_FETCH_FAILED = 'DATA_FETCH_FAILED',
  
  // Usage Limits
  FREE_LIMIT_EXCEEDED = 'FREE_LIMIT_EXCEEDED',
  RATE_LIMITED = 'RATE_LIMITED',
  IP_BANNED = 'IP_BANNED',
  
  // Auth/Permission
  UNAUTHORIZED = 'UNAUTHORIZED',
  PRO_REQUIRED = 'PRO_REQUIRED',
  TRIAL_EXPIRED = 'TRIAL_EXPIRED',
  
  // System
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  MAINTENANCE = 'MAINTENANCE',
}

export interface TradeLensError {
  error_code: ErrorCode;
  message: string; // Technical message
  user_message: string; // User-friendly message
  retry_after_seconds?: number;
  upgrade_required?: boolean;
  can_retry?: boolean;
  details?: Record<string, any>;
}

// Error message mappings
const ERROR_MESSAGES: Record<ErrorCode, { user: string; can_retry: boolean }> = {
  // AI/Provider Errors
  AI_TIMEOUT: {
    user: 'AI analysis is taking longer than expected. Trying with cached data...',
    can_retry: true,
  },
  PROVIDER_DOWN: {
    user: 'Market data provider is temporarily unavailable. Please try again in a moment.',
    can_retry: true,
  },
  AI_RATE_LIMIT: {
    user: 'AI service is experiencing high demand. Please wait a moment.',
    can_retry: true,
  },
  
  // Data Errors
  INVALID_TICKER: {
    user: 'This ticker symbol was not found. Please check the spelling.',
    can_retry: false,
  },
  INSUFFICIENT_DATA: {
    user: 'Not enough market data available for this analysis.',
    can_retry: false,
  },
  DATA_FETCH_FAILED: {
    user: 'Unable to fetch market data. Please try again.',
    can_retry: true,
  },
  
  // Usage Limits
  FREE_LIMIT_EXCEEDED: {
    user: 'Daily limit reached (10 signals). Upgrade to Pro for unlimited access.',
    can_retry: false,
  },
  RATE_LIMITED: {
    user: 'Too many requests. Please wait before trying again.',
    can_retry: true,
  },
  IP_BANNED: {
    user: 'Access temporarily restricted due to unusual activity. Contact support if this persists.',
    can_retry: false,
  },
  
  // Auth/Permission
  UNAUTHORIZED: {
    user: 'Please sign in to access this feature.',
    can_retry: false,
  },
  PRO_REQUIRED: {
    user: 'This is a Pro feature. Start your 3-day free trial to unlock it.',
    can_retry: false,
  },
  TRIAL_EXPIRED: {
    user: 'Your trial has ended. Upgrade to Pro to continue using this feature.',
    can_retry: false,
  },
  
  // System
  SYSTEM_ERROR: {
    user: 'Something went wrong. Our team has been notified.',
    can_retry: true,
  },
  DATABASE_ERROR: {
    user: 'Database connection issue. Please try again in a moment.',
    can_retry: true,
  },
  MAINTENANCE: {
    user: 'TradeLens is undergoing brief maintenance. We\'ll be back shortly.',
    can_retry: true,
  },
};

/**
 * Create structured error response
 */
export function createError(
  code: ErrorCode,
  details?: Record<string, any>
): TradeLensError {
  const config = ERROR_MESSAGES[code];
  
  return {
    error_code: code,
    message: code, // Technical identifier
    user_message: config.user,
    can_retry: config.can_retry,
    upgrade_required: code === ErrorCode.FREE_LIMIT_EXCEEDED || 
                      code === ErrorCode.PRO_REQUIRED ||
                      code === ErrorCode.TRIAL_EXPIRED,
    retry_after_seconds: code === ErrorCode.RATE_LIMITED ? 60 : undefined,
    ...details,
  };
}

/**
 * Check if feature flag is enabled
 */
export function isErrorCodesEnabled(): boolean {
  return Deno.env.get('FEATURE_ERROR_CODES') === 'true';
}

/**
 * Wrap error in structured format (only if flag enabled)
 */
export function wrapError(
  code: ErrorCode,
  originalError?: Error,
  details?: Record<string, any>
): TradeLensError {
  // If feature flag is off, return basic error
  if (!isErrorCodesEnabled()) {
    return {
      error_code: ErrorCode.SYSTEM_ERROR,
      message: originalError?.message || 'An error occurred',
      user_message: originalError?.message || 'An error occurred',
      can_retry: true,
    };
  }
  
  // Feature flag is ON - return structured error
  return createError(code, {
    ...details,
    original_error: originalError?.message,
    stack: Deno.env.get('DENO_ENV') === 'development' ? originalError?.stack : undefined,
  });
}

/**
 * Create error response
 */
export function errorResponse(
  error: TradeLensError,
  status: number = 500
): Response {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };
  
  return new Response(
    JSON.stringify(error),
    {
      status,
      headers: {
        ...corsHeaders,
        ...(error.retry_after_seconds ? { 'Retry-After': error.retry_after_seconds.toString() } : {}),
      },
    }
  );
}
