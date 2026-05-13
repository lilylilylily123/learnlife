import type PocketBase from "pocketbase";

export async function login(pb: PocketBase, email: string, password: string) {
  return pb.collection("users").authWithPassword(email, password);
}

export async function loginAsLearner(pb: PocketBase, email: string, password: string) {
  return pb.collection("users").authWithPassword(email, password);
  // Note: caller should verify the returned record has role === "learner"
}

export function logout(pb: PocketBase) {
  pb.authStore.clear();
}

export function isAuthenticated(pb: PocketBase): boolean {
  return pb.authStore.isValid;
}

export function getCurrentUser(pb: PocketBase) {
  return pb.authStore.record;
}

export async function requestPasswordReset(pb: PocketBase, email: string) {
  await pb.collection("users").requestPasswordReset(email);
}

/**
 * Change the current user's password while they are signed in.
 *
 * PocketBase requires `oldPassword` alongside `password`/`passwordConfirm` for
 * authenticated password changes — without it the update is rejected. On
 * success PB invalidates other sessions; we re-authenticate so the local
 * session keeps working.
 */
export async function changePassword(
  pb: PocketBase,
  args: { oldPassword: string; newPassword: string },
): Promise<void> {
  const user = pb.authStore.record;
  if (!user?.id || !user?.email) {
    throw new Error("Not signed in.");
  }
  await pb.collection("users").update(user.id, {
    oldPassword: args.oldPassword,
    password: args.newPassword,
    passwordConfirm: args.newPassword,
  });
  // PB rotates the token; re-auth so subsequent requests succeed.
  await pb.collection("users").authWithPassword(user.email, args.newPassword);
}
