import PocketBase from "pocketbase";
import { PB_URL } from "./constants";

export interface PBClientOptions {
  /** Override the default hosted PocketBase URL (useful in tests / self-hosted setups). */
  url?: string;
  /**
   * Custom auth store, e.g. an AsyncAuthStore backed by AsyncStorage for React Native.
   * Typed as `any` because PocketBase's AsyncAuthStore is not in the base type bundle.
   */
  authStore?: any; // PocketBase AuthStore or AsyncAuthStore
}

/**
 * Factory that creates a configured PocketBase client.
 *
 * Auto-cancellation is disabled so that rapid back-to-back calls (e.g. NFC
 * scans arriving in quick succession) are all executed rather than being
 * silently cancelled by PocketBase's default request deduplication.
 */
export function createPBClient(options: PBClientOptions = {}): PocketBase {
  const url = options.url ?? PB_URL;
  const pb = new PocketBase(url, options.authStore);
  // Disable auto-cancellation: PocketBase cancels identical in-flight requests
  // by default, which can silently drop legitimate NFC scan bursts.
  pb.autoCancellation(false);
  return pb;
}
