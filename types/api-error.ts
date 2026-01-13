/**
 * Structured API Error Response Types
 * Matches backend error_codes.ts structure
 * 
 * Used when FEATURE_ERROR_CODES is enabled on backend
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

export interface ApiError {
  error_code: ErrorCode;
  message: string; // Technical message
  user_message: string; // User-friendly message
  retry_after_seconds?: number;
  upgrade_required?: boolean;
  can_retry?: boolean;
  details?: Record<string, any>;
}

export class ApiException extends Error {
  constructor(public apiError: ApiError) {
    super(apiError.user_message);
    this.name = 'ApiException';
  }

  get errorCode() {
    return this.apiError.error_code;
  }

  get userMessage() {
    return this.apiError.user_message;
  }

  get canRetry() {
    return this.apiError.can_retry ?? false;
  }

  get upgradeRequired() {
    return this.apiError.upgrade_required ?? false;
  }

  get retryAfter() {
    return this.apiError.retry_after_seconds;
  }

  isFreeLimitExceeded() {
    return this.errorCode === ErrorCode.FREE_LIMIT_EXCEEDED;
  }

  isProRequired() {
    return this.errorCode === ErrorCode.PRO_REQUIRED || 
           this.errorCode === ErrorCode.TRIAL_EXPIRED;
  }

  isRateLimited() {
    return this.errorCode === ErrorCode.RATE_LIMITED;
  }

  isAuthError() {
    return this.errorCode === ErrorCode.UNAUTHORIZED;
  }

  isDataError() {
    return this.errorCode === ErrorCode.INVALID_TICKER || 
           this.errorCode === ErrorCode.INSUFFICIENT_DATA ||
           this.errorCode === ErrorCode.DATA_FETCH_FAILED;
  }

  shouldShowUpgradePrompt() {
    return this.upgradeRequired || this.isFreeLimitExceeded() || this.isProRequired();
  }
}

/**
 * Parse error response from API
 */
export function parseApiError(error: any): ApiException | Error {
  // Check if response has error_code field (structured error)
  if (error?.error_code) {
    return new ApiException(error as ApiError);
  }

  // Check if it's already an ApiException
  if (error instanceof ApiException) {
    return error;
  }

  // Fallback to generic error
  return error instanceof Error ? error : new Error(String(error));
}
