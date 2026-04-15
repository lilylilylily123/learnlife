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

export async function register(
  pb: PocketBase,
  userData: { email: string; password: string; passwordConfirm: string; name: string; role: string; learner?: string; [key: string]: any },
) {
  const record = await pb.collection("users").create(userData);
  await pb.collection("users").authWithPassword(userData.email, userData.password);
  return record;
}

export function isAuthenticated(pb: PocketBase): boolean {
  return pb.authStore.isValid;
}

export function getCurrentUser(pb: PocketBase) {
  return pb.authStore.record;
}
