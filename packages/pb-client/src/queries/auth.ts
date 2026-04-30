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
