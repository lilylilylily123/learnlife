"use client";
import PocketBase from "pocketbase";

const url = "https://learnlife.pockethost.io/";

// Extend Window interface for global pb instance
declare global {
  interface Window {
    __pb?: PocketBase;
  }
}

// Create singleton instance and store globally
function createPb(): PocketBase {
  if (typeof window !== "undefined") {
    if (window.__pb) {
      return window.__pb;
    }
  }
  
  const instance = new PocketBase(url);
  instance.autoCancellation(false);
  
  if (typeof window !== "undefined") {
    window.__pb = instance;
  }
  
  return instance;
}

export const pb = createPb();
