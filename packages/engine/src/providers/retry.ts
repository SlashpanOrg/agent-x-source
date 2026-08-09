/**
 * Shared retry helper for transient HTTP errors (429, 500, 502, 503, 504).
 *
 * The AI SDK's `maxRetries` parameter only covers `streamText`/`generateText`
 * calls. Direct `provider.complete()` calls (reformulateQuery, extractMemories,
 * benchmark) have no retry logic and fail immediately when the provider's
 * queue is full. This helper adds exponential backoff retry for those calls.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Default retry configuration — 2 retries with exponential backoff (1s, 2s). */
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1_000;

/**
 * Wrap a fetch call with retry logic for transient HTTP errors.
 * Returns the Response object on success, throws on non-retryable errors
 * or after exhausting retries.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
  },
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok) return response;

      // Check if the error is retryable
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        // Read the error body for logging, then discard
        const errorText = await response.text().catch(() => '');
        lastError = new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);

        // Exponential backoff: baseDelay * 2^attempt (1s, 2s, 4s, ...)
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable error or retries exhausted — throw with the response body
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 500)}`);
    } catch (err) {
      // Network errors (ECONNRESET, ETIMEDOUT, etc.) are also retryable
      if (err instanceof Error) {
        const isAbort = err.name === 'AbortError' || (init.signal as AbortSignal | undefined)?.aborted;
        if (isAbort) throw err;

        const isNetworkError = !('status' in err) && attempt < maxRetries;
        if (isNetworkError) {
          lastError = err;
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError ?? new Error('fetchWithRetry: exhausted retries with no error');
}
