/**
 * Retry a PocketBase request when the server responds with HTTP 429 (rate limited).
 *
 * Uses exponential back-off: each retry multiplies the delay by 1.5.
 * Only retries on 429; all other errors are re-thrown immediately.
 *
 * @param fn       Async function to retry (should be idempotent)
 * @param retries  Max number of additional attempts after the first failure (default 3)
 * @param delay    Initial wait in ms before the first retry (default 800 ms)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 800,
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries > 0 && err?.status === 429) {
      await new Promise((r) => setTimeout(r, delay));
      // Recurse with one fewer retry and a longer delay (exponential back-off).
      return withRetry(fn, retries - 1, delay * 1.5);
    }
    throw err;
  }
}
