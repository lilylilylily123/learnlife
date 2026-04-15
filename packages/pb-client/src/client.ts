import PocketBase from "pocketbase";
import { PB_URL } from "./constants";

export interface PBClientOptions {
  url?: string;
  authStore?: any; // PocketBase AuthStore or AsyncAuthStore
}

export function createPBClient(options: PBClientOptions = {}): PocketBase {
  const url = options.url ?? PB_URL;
  const pb = new PocketBase(url, options.authStore);
  pb.autoCancellation(false);
  return pb;
}
