"use client";
import { createPBClient, PB_URL } from "@learnlife/pb-client";

declare global {
  interface Window {
    __pb?: ReturnType<typeof createPBClient>;
  }
}

function getPb() {
  if (typeof window !== "undefined" && window.__pb) {
    return window.__pb;
  }

  const instance = createPBClient({ url: PB_URL });

  if (typeof window !== "undefined") {
    window.__pb = instance;
  }

  return instance;
}

export const pb = getPb();
