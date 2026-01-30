/**
 * Retry Utility with Exponential Backoff
 * Handles transient failures in signal generation
 */

export interface RetryOptions {
  maxAttempts?: number;          // Default: 2 (1 initial + 1 retry)
  initialDelayMs?: number;       // Default: 1000ms
  maxDelayMs?: number;           // Default: 4000ms
  backoffMultiplier?: number;    // Default: 2
  timeout?: number;              // Timeout per attempt in ms. Default: 15000
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attemptsMade: number;
  lastError?: Error;
}

/**
 * Classify error as transient (retryable) or permanent (non-retryable)
 */
export function isTransientError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase();
  const code = error?.code || error?.status || 0;

  // Network/timeout errors (transient)
  if (
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('connection') ||
    message.includes('network')
  ) {
    return true;
  }

  // HTTP 429 (rate limit), 503 (service unavailable), 502 (bad gateway), 504 (timeout)
  if ([429, 503, 502, 504].includes(code)) {
    return true;
  }

  // Yahoo Finance or external API errors
  if (message.includes('yahoo') && message.includes('error')) {
    return true;
  }

  // OpenAI rate limits
  if (message.includes('rate_limit')) {
    return true;
  }

  // Supabase transient errors
  if (message.includes('temporarily unavailable')) {
    return true;
  }

  return false;
}

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Result with success status and data/error
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? 2;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const timeout = options.timeout ?? 15000;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Execute with timeout
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${timeout}ms`)),
            timeout
          )
        ),
      ]);

      return {
        success: true,
        data: result,
        attemptsMade: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is transient
      if (!isTransientError(error)) {
        // Permanent error - don't retry
        return {
          success: false,
          error: lastError.message,
          attemptsMade: attempt,
          lastError,
        };
      }

      // Transient error - maybe retry
      if (attempt < maxAttempts) {
        console.warn(
          `[retry] Attempt ${attempt}/${maxAttempts} failed (transient): ${lastError.message}. Retrying in ${delayMs}ms...`
        );

        // Wait before retry
        await sleep(delayMs);

        // Increase delay for next attempt
        delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
      } else {
        console.error(
          `[retry] Attempt ${attempt}/${maxAttempts} failed. No more retries.`,
          lastError.message
        );
      }
    }
  }

  // All attempts failed
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    attemptsMade: maxAttempts,
    lastError,
  };
}

/**
 * Retry multiple independent operations in parallel
 * Useful for retrying symbol processing in parallel
 */
export async function retryMultipleAsync<T>(
  operations: Array<{ id: string; fn: () => Promise<T> }>,
  options: RetryOptions = {}
): Promise<Map<string, RetryResult<T>>> {
  const results = new Map<string, RetryResult<T>>();

  const promises = operations.map(async (op) => {
    const result = await retryWithBackoff(op.fn, options);
    results.set(op.id, result);
  });

  await Promise.all(promises);
  return results;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a typed retry handler for specific error scenarios
 */
export function createRetryHandler<T>(
  operationName: string,
  options: RetryOptions = {}
) {
  return async (fn: () => Promise<T>): Promise<RetryResult<T>> => {
    const result = await retryWithBackoff(fn, options);

    if (!result.success) {
      console.error(
        `[${operationName}] Failed after ${result.attemptsMade} attempts: ${result.error}`
      );
    }

    return result;
  };
}
