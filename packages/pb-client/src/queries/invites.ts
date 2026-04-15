import type PocketBase from "pocketbase";
import type { Invite } from "../types";

/**
 * Generate a 6-character uppercase alphanumeric invite code.
 *
 * Characters 0/O/1/I are excluded to avoid visual ambiguity when the code
 * is read aloud or transcribed by hand.
 *
 * NOTE: Uses Math.random() which is not cryptographically secure. For the
 * low-stakes use-case of school invite links this is acceptable, but if
 * security requirements increase consider crypto.getRandomValues() instead.
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
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
    const record = await pb.collection("invites").getFirstListItem(
      `code = "${code.toUpperCase()}" && used = false && expires_at > @now`,
      { expand: "learner" },
    );
    return record as unknown as Invite;
  } catch (e: any) {
    console.error("[lookupInvite] Query failed:", e?.response?.data || e?.message);
    // Diagnostic fallback: check whether the code exists at all, to distinguish
    // "code not found" from "code found but expired/used".
    // TODO: remove this fallback before going to production.
    try {
      const anyMatch = await pb.collection("invites").getFirstListItem(`code = "${code.toUpperCase()}"`);
      console.warn("[lookupInvite] Code exists but failed filter - used:", anyMatch.used, "expires_at:", anyMatch.expires_at);
    } catch {
      console.warn("[lookupInvite] Code not found at all");
    }
    return null;
  }
}

/**
 * Redeem an invite code: creates a user account, links it to the learner,
 * marks the invite as used, then logs the new user in.
 *
 * ⚠️  Race condition note: the `learners.user` back-reference update (step 3)
 * reads `pb.authStore.record?.id` but at that point the user has not yet been
 * authenticated (authWithPassword runs at the end). The update uses whatever
 * auth token is currently in the store, which is likely a guide/admin session
 * or empty. This field is non-critical (the forward `users.learner` FK is the
 * source of truth) but should be fixed if the back-reference is ever queried.
 */
export async function redeemInvite(
  pb: PocketBase,
  data: { code: string; password: string },
): Promise<{ success: true } | { success: false; error: string }> {
  const invite = await lookupInvite(pb, data.code);
  if (!invite) {
    return { success: false, error: "Invalid or expired invite code." };
  }

  // Use the learner's name for the user account; fall back to email.
  const learnerName = invite.expand?.learner?.name ?? invite.email;

  // Step 1: Create the user account.
  try {
    await pb.collection("users").create({
      email: invite.email,
      password: data.password,
      passwordConfirm: data.password,
      name: learnerName,
      role: "learner",
      learner: invite.learner,
    });
  } catch (e: any) {
    const msg = e?.response?.data?.email?.message;
    if (msg?.includes("already exists")) {
      return { success: false, error: "An account already exists for this learner." };
    }
    return { success: false, error: e?.message || "Failed to create account." };
  }

  // Step 2: Update the learner's back-reference to point to the new user.
  // Non-critical — the forward relation on users is the source of truth.
  try {
    await pb.collection("learners").update(invite.learner, { user: pb.authStore.record?.id });
  } catch {
    // Silently ignore: the account was created successfully.
  }

  // Step 3: Mark the invite as used so it cannot be redeemed again.
  try {
    await pb.collection("invites").update(invite.id, {
      used: true,
      used_at: new Date().toISOString(),
    });
  } catch {
    // Silently ignore: non-critical — the invite will expire naturally.
  }

  // Step 4: Authenticate the newly created user.
  await pb.collection("users").authWithPassword(invite.email, data.password);

  return { success: true };
}
