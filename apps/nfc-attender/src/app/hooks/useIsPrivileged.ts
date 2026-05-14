"use client";
import { useEffect, useState } from "react";
import { pb } from "../pb";

// Treat learner-role accounts as logged out — nfc-attender is a guide tool.
function checkPrivileged(): boolean {
  const role = (pb.authStore.record as { role?: string } | null)?.role;
  return pb.authStore.isValid && (role === "admin" || role === "lg");
}

export function useIsPrivileged(): boolean {
  const [isPrivileged, setIsPrivileged] = useState<boolean>(() =>
    typeof window === "undefined" ? false : checkPrivileged(),
  );

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => setIsPrivileged(checkPrivileged()));
    return () => unsubscribe();
  }, []);

  return isPrivileged;
}
