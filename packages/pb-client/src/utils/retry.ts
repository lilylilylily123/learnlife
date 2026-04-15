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
      return withRetry(fn, retries - 1, delay * 1.5);
    }
    throw err;
  }
}
