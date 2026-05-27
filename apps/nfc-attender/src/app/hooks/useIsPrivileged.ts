"use client";
import { useSyncExternalStore } from "react";
import { pb } from "../pb";

// Treat learner-role accounts as logged out — nfc-attender is a guide tool.
function checkPrivileged(): boolean {
  const role = (pb.authStore.record as { role?: string } | null)?.role;
  return pb.authStore.isValid && (role === "admin" || role === "lg");
}

function subscribe(notify: () => void) {
  return pb.authStore.onChange(notify);
}

function getServerSnapshot(): boolean {
  // The static export emits the not-logged-in shell, so the SSR/first-paint
  // value must be `false`. The real auth state arrives on the next client tick.
  return false;
}

export function useIsPrivileged(): boolean {
  // useSyncExternalStore is the SSR-safe escape hatch for "read from external
  // store" — it picks getServerSnapshot during prerender + first client paint,
  // then swaps in checkPrivileged() once React has hydrated. Avoids the
  // hydration-mismatch crash AttenderD threw when the sync useState init
  // read a different auth value than the server.
  return useSyncExternalStore(subscribe, checkPrivileged, getServerSnapshot);
}
