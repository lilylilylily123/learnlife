// Minimal PocketBase mock for Jest — avoids importing the real ESM .mjs module
export default class PocketBase {
  authStore = { model: null, isValid: false, onChange: () => () => {} };
  constructor(_url?: string, _authStore?: any) {}
  autoCancellation(_value: boolean) {}
  collection(_name: string) {
    return { getFullList: async () => [], getList: async () => ({ items: [], totalItems: 0, totalPages: 0 }) };
  }
}

export class AsyncAuthStore {
  constructor(_opts?: any) {}
}
