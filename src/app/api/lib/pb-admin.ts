import PocketBase from "pocketbase";

const PB_URL =
  process.env.PB_URL ||
  process.env.NEXT_PUBLIC_PB_URL ||
  "https://learnlife.pockethost.io/";
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

// Module-level cache for authenticated PocketBase instance
let cachedPb: PocketBase | null = null;
let authPromise: Promise<PocketBase> | null = null;
let lastAuthTime = 0;

// Re-auth if token is older than 5 minutes (be more aggressive to avoid stale tokens)
const AUTH_REFRESH_MS = 5 * 60 * 1000;

/**
 * Get an authenticated PocketBase admin client.
 * Caches the auth token so subsequent calls don't re-authenticate.
 * Safe for serverless - will re-auth if token expires or is stale.
 */
export async function getAdminPb(): Promise<PocketBase> {
  const now = Date.now();
  
  // If we have a valid cached instance that's not too old, return it
  if (cachedPb && cachedPb.authStore.isValid && (now - lastAuthTime) < AUTH_REFRESH_MS) {
    return cachedPb;
  }
  
  // Clear stale cache
  if (cachedPb && (!cachedPb.authStore.isValid || (now - lastAuthTime) >= AUTH_REFRESH_MS)) {
    cachedPb = null;
    lastAuthTime = 0;
  }

  // If auth is already in progress, wait for it
  if (authPromise) {
    return authPromise;
  }

  // Start new auth - store promise first to prevent race conditions
  const promise = (async () => {
    try {
      const pb = new PocketBase(PB_URL);

      if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
        throw new Error("PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set in environment");
      }

      await pb.collection("_superusers").authWithPassword(
        PB_ADMIN_EMAIL,
        PB_ADMIN_PASSWORD
      );
      
      cachedPb = pb;
      lastAuthTime = Date.now();
      return pb;
    } catch (err: any) {
      // Clear cache on failure so next request retries
      cachedPb = null;
      lastAuthTime = 0;
      console.error("[pb-admin] Auth failed:", err.message || err);
      throw err;
    }
  })();
  
  authPromise = promise;
  
  // Clean up authPromise after resolution (success or failure)
  promise.finally(() => {
    // Only clear if it's still our promise (not replaced by another)
    if (authPromise === promise) {
      authPromise = null;
    }
  });

  return promise;
}

/**
 * Clear the cached PocketBase instance.
 * Call this when auth fails to force re-authentication on next request.
 */
export function clearAdminPbCache(): void {
  cachedPb = null;
  lastAuthTime = 0;
  authPromise = null;
}
