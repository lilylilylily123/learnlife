import type PocketBase from "pocketbase";
import type { Invite } from "../types";

/** Generate a 6-character uppercase alphanumeric invite code. */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

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
  } catch {
    return null;
  }
}

export async function redeemInvite(
  pb: PocketBase,
  data: { code: string; password: string },
): Promise<{ success: true } | { success: false; error: string }> {
  const invite = await lookupInvite(pb, data.code);
  if (!invite) {
    return { success: false, error: "Invalid or expired invite code." };
  }

  const learnerName = invite.expand?.learner?.name ?? invite.email;

  // Create user account linked to the learner
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

  // Update learner back-reference
  try {
    await pb.collection("learners").update(invite.learner, { user: pb.authStore.record?.id });
  } catch {
    // non-critical — the forward relation on users is the source of truth
  }

  // Mark invite as used
  try {
    await pb.collection("invites").update(invite.id, {
      used: true,
      used_at: new Date().toISOString(),
    });
  } catch {
    // non-critical
  }

  // Log the user in
  await pb.collection("users").authWithPassword(invite.email, data.password);

  return { success: true };
}
