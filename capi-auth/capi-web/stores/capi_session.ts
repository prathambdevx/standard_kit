// v2 — Shopify Customer Account API (CAPI) login, additive alongside the
// optional v1 Storefront session (./session.ts). Holds only an opaque
// BFF-issued session id, never Shopify's real access/refresh/id tokens — the
// BFF keeps those server-side (see capi-idp/capi/session_store.ts) and
// rotates them on refresh without this store or its caller ever needing to
// know. Deliberate: refresh logic lives once, server-side, not duplicated
// across every client (web, mobile).

import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StorageLike } from '../storage';
import type { Customer } from './session';

export const CAPI_SESSION_STORAGE_KEY = 'auth-capi-session';

export interface CapiSessionState {
  sessionId: string | null;
  isActive: boolean;
  hasHydrated: boolean;
  // Identity for THIS credential kind. Deliberately not read off the v1 session
  // store: that store nulls `customer` on rehydrate whenever there's no live v1
  // token — always the case for a CAPI customer — so borrowing it meant v2's
  // identity silently vanished on every reload. v2 owns its own, keyed to its
  // own session id, and works with v1 fully absent (or entirely unused).
  customer: Customer | null;

  setSession: (sessionId: string) => void;
  setCustomer: (customer: Customer) => void;
  clearSession: () => void;
}

const CLEARED = {
  hasHydrated: true,
  isActive: false,
  sessionId: null,
  customer: null,
};

export type CapiSessionStore = StoreApi<CapiSessionState> & {
  persist: { rehydrate: () => void | Promise<void> };
};

export function createCapiSessionStore(storage: StorageLike): CapiSessionStore {
  const store = createStore<CapiSessionState>()(
    persist(
      (set) => ({
        sessionId: null,
        isActive: false,
        hasHydrated: false,
        customer: null,

        // Clears `customer` in the same write: the caller fetches the profile
        // afterwards, and on a shared device (or if that fetch fails) leaving the
        // previous customer's identity beside a new session id would greet them by
        // the wrong name and send the wrong shopifyId to every analytics vendor.
        setSession: (sessionId) => set({ sessionId, isActive: true, customer: null }),
        setCustomer: (customer) => set({ customer }),
        clearSession: () => set({ sessionId: null, isActive: false, customer: null }),
      }),
      {
        name: CAPI_SESSION_STORAGE_KEY,
        storage: createJSONStorage(() => storage),
        partialize: (s) => ({ sessionId: s.sessionId, customer: s.customer }),
        skipHydration: true,
        onRehydrateStorage: () => (_state, error) => {
          void Promise.resolve().then(() => {
            if (error) {
              store.setState(CLEARED);
              return;
            }
            // the BFF, not this store, knows if the session is still valid — a
            // present sessionId is provisionally active; a stale/revoked one is
            // caught on the next BFF call, not by any client-side expiry check
            const { sessionId } = store.getState();
            store.setState(sessionId ? { hasHydrated: true, isActive: true } : CLEARED);
          });
        },
      },
    ),
  ) as CapiSessionStore;

  return store;
}
