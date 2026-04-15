import type { UserRole } from "@learnlife/pb-client";

export function isGuide(role: UserRole | null | undefined): boolean {
  return role === "lg" || role === "admin";
}

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function isLearner(role: UserRole | null | undefined): boolean {
  return role === "learner";
}
