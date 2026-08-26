// v1 — legacy Storefront customerAccessToken session. Optional: skip this
// store entirely if your app is CAPI-only (capi_session.ts). Persisted
// through the injected StorageLike so the same code works on web and mobile.

import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StorageLike } from '../storage';

export const SESSION_STORAGE_KEY = 'auth-session'; // rename per project if you already have a key in use

export interface Customer {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  shopifyId?: string; // bare numeric (gid stripped)
}

export interface SessionState {
  token: string | null;
  expiresAt: string | null; // ISO 8601
  customer: Customer | null;
  isLoggedIn: boolean;
  hasHydrated: boolean;

  setSession: (token: string, expiresAt: string) => void;
  setCustomer: (customer: Customer) => void;
  logout: () => void;
}

const isLive = (expiresAt: string | null) => !!expiresAt && Date.parse(expiresAt) > Date.now();

const LOGGED_OUT = {
  hasHydrated: true,
  isLoggedIn: false,
  token: null,
  expiresAt: null,
  customer: null,
};

export type SessionStore = StoreApi<SessionState> & {
  persist: { rehydrate: () => void | Promise<void> };
};

export function createSessionStore(storage: StorageLike): SessionStore {
  const store = createStore<SessionState>()(
    persist(
      (set) => ({
        token: null,
        expiresAt: null,
        customer: null,
        isLoggedIn: false,
        hasHydrated: false,

        setSession: (token, expiresAt) => set({ token, expiresAt, isLoggedIn: isLive(expiresAt) }),
        setCustomer: (customer) => set({ customer }),
        logout: () => set({ token: null, expiresAt: null, customer: null, isLoggedIn: false }),
      }),
      {
        name: SESSION_STORAGE_KEY,
        storage: createJSONStorage(() => storage),
        partialize: (s) => ({ token: s.token, expiresAt: s.expiresAt, customer: s.customer }),
        // hydration is explicit (call .persist.rehydrate() client-side once) — SSR never touches storage
        skipHydration: true,
        onRehydrateStorage: () => (_state, error) => {
          // microtask: runs after zustand applied the hydrated values
          void Promise.resolve().then(() => {
            if (error) {
              // corrupt blob — start clean but mark hydrated
              store.setState(LOGGED_OUT);
              return;
            }
            // an expired token is useless — never claim a dead session
            const { token, expiresAt } = store.getState();
            store.setState(
              token && isLive(expiresAt) ? { hasHydrated: true, isLoggedIn: true } : LOGGED_OUT,
            );
          });
        },
      },
    ),
  ) as SessionStore;

  return store;
}
