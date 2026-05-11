import type PocketBase from "pocketbase";
import type { Invite } from "../types";

/**
 * Generate a 6-character uppercase alphanumeric invite code.
 *
 * Characters 0/O/1/I are excluded to avoid visual ambiguity when the code
 * is read aloud or transcribed by hand. The 32-character alphabet is a power
 * of two so rejection-sampling isn't needed — each random byte mod 32 is
 * uniformly distributed across the alphabet.
 */
// Available in modern browsers, React Native (Hermes), and Node 18+.
// Lib config doesn't include `dom`, so reach for the global explicitly.
const webCrypto = (globalThis as { crypto?: { getRandomValues(arr: Uint8Array): Uint8Array } }).crypto;

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  if (!webCrypto) {
    throw new Error("crypto.getRandomValues is not available in this runtime");
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(6));
  let code = "";
  for (let i = 0; i < bytes.length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Create a new invite for a learner. The invite expires after 7 days and can
 * be redeemed once via `redeemInvite`.
 */
export async function createInvite(
  pb: PocketBase,
  data: { learnerId: string; email: string; createdBy: string },
): Promise<Invite> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const record = await pb.collection("invites").create({
    code: generateInviteCode(),
    learner: data.learnerId,
    email: data.email,
    expires_at: expiresAt.toISOString(),
    used: false,
    created_by: data.createdBy,
  });
  return record as unknown as Invite;
}

/**
 * List invites. By default only active (unused, non-expired) invites are shown.
 * Pass `showUsed: true` to include all historical invites.
 */
export async function listInvites(
  pb: PocketBase,
  opts: { showUsed?: boolean } = {},
): Promise<Invite[]> {
  const filter = opts.showUsed ? "" : "used = false && expires_at > @now";
  const records = await pb.collection("invites").getFullList({
    filter: filter || undefined,
    sort: "-created",
    expand: "learner",
  });
  return records as unknown as Invite[];
}

/**
 * Look up an invite by its code.
 *
 * Returns the invite record if the code is valid, unused, and not expired.
 * Returns null if the invite cannot be found or the filter conditions are not met.
 *
 * The diagnostic fallback query (lines below) logs extra info to help debug
 * expiry/used-flag mismatches during development — remove before production.
 */
export async function lookupInvite(
  pb: PocketBase,
  code: string,
): Promise<Invite | null> {
  try {
    const record = await pb
      .collection("invites")
      .getFirstListItem(
        pb.filter(
          "code = {:code} && used = false && expires_at > @now",
          { code: code.toUpperCase() },
        ),
        { expand: "learner" },
      );
    return record as unknown as Invite;
  } catch {
    return null;
  }
}

/**
 * Redeem an invite code via the atomic server-side hook
 * (POST /api/redeem-invite — see pb_hooks/invites.pb.js).
 *
 * The hook runs the invite lookup, user creation, learner back-reference
 * update, and invite-mark-used inside a single PocketBase transaction, then
 * mints an auth token. We save that token into pb.authStore so the AuthContext
 * picks it up like any other login.
 *
 * Requires the invites.pb.js hook to be deployed to PocketBase. If the hook
 * is missing, the request returns 404 and we surface a generic error.
 */
export async function redeemInvite(
  pb: PocketBase,
  data: { code: string; password: string },
): Promise<{ success: true } | { success: false; error: string }> {
  type AuthResponse = { token: string; record: { [k: string]: unknown; id: string } };
  try {
    const response = await pb.send<AuthResponse>("/api/redeem-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: data.code.toUpperCase(),
        password: data.password,
      }),
    });
    if (!response?.token || !response?.record) {
      return { success: false, error: "Unexpected server response." };
    }
    // Cast through unknown — AsyncAuthStore types AuthRecord as the PB record
    // type, which we don't import here; the shape from the server matches.
    pb.authStore.save(response.token, response.record as unknown as Parameters<typeof pb.authStore.save>[1]);
    return { success: true };
  } catch (e: unknown) {
    const err = e as { status?: number; data?: { message?: string }; message?: string };
    if (err.status === 400) {
      // The hook returns specific 400 messages for known cases (invalid code,
      // weak password). Pass them through — they're already user-safe.
      const msg = err.data?.message || "Invalid or expired code.";
      return { success: false, error: msg };
    }
    if (err.status === 404) {
      return {
        success: false,
        error: "Registration is temporarily unavailable. Please try again later.",
      };
    }
    return { success: false, error: "Couldn't redeem invite. Please try again." };
  }
}
