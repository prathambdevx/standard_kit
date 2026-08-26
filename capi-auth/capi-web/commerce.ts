// Wires the two auth stores together for a project — the minimal analog of
// bsc-platform's `createCommerce` (packages/commerce/src/index.ts), with the
// cart/wishlist/customizer pieces stripped out since those are product-specific,
// not part of this kit. Add your own product stores the same way: a `.subscribe`
// on the login edge (below) that merges guest state into the customer's on
// login, and resets on logout.

import { useStore } from 'zustand';
import {
  type CapiSessionState,
  type CapiSessionStore,
  createCapiSessionStore,
} from './stores/capi_session';
import { createSessionStore, type SessionState, type SessionStore } from './stores/session';
import type { StorageLike } from './storage';

export type AuthStoresConfig = {
  /** web: localStorage · RN: MMKV wrapper · SSR/tests: memoryStorage() from ./storage */
  storage: StorageLike;
};

export type AuthStores = {
  /** Vanilla stores — non-React reads/subscriptions (credential seam, SDK adapters, tests). */
  session: SessionStore; // v1 — optional, skip if you're CAPI-only
  capiSession: CapiSessionStore; // v2

  /** Selector-pattern hooks — components re-render only on the slice they read. */
  useSession: <T>(selector: (state: SessionState) => T) => T;
  useCapiSession: <T>(selector: (state: CapiSessionState) => T) => T;

  /** true once EITHER credential is live. A CAPI login never sets the v1
   *  store's own isLoggedIn, so checking only one silently drops every
   *  CAPI customer from login gates (header, redirect-if-logged-in, etc). */
  useIsLoggedIn: () => boolean;
  /** true once BOTH stores have finished reading persisted storage — gate any
   *  render that depends on knowing the real auth state (not the SSR default). */
  useSessionHydrated: () => boolean;

  /** Reads persisted storage into both stores. Call once, client-side, on boot
   *  — never during SSR (skipHydration is set on both stores for this reason). */
  hydrate: () => void;

  /** Register a callback that fires on login (either credential going
   *  false→true) and on logout (true→false) — exactly once per edge crossing,
   *  not on every store write. Use this to merge a guest cart/wishlist on
   *  login and reset it on logout, same pattern bsc-platform's cart/wishlist
   *  stores use (see ../README.md's Frontend wiring section). */
  onAuthEdge: (handlers: { onLogin: () => void; onLogout: () => void }) => void;
};

export function createAuthStores(config: AuthStoresConfig): AuthStores {
  const session = createSessionStore(config.storage);
  const capiSession = createCapiSessionStore(config.storage);

  const edgeHandlers: Array<{ onLogin: () => void; onLogout: () => void }> = [];

  let wasLoggedIn = session.getState().isLoggedIn;
  session.subscribe((state) => {
    if (state.isLoggedIn === wasLoggedIn) return;
    wasLoggedIn = state.isLoggedIn;
    for (const h of edgeHandlers) (state.isLoggedIn ? h.onLogin : h.onLogout)();
  });

  let wasCapiActive = capiSession.getState().isActive;
  capiSession.subscribe((state) => {
    if (state.isActive === wasCapiActive) return;
    wasCapiActive = state.isActive;
    for (const h of edgeHandlers) (state.isActive ? h.onLogin : h.onLogout)();
  });

  return {
    session,
    capiSession,
    useSession: (selector) => useStore(session, selector),
    useCapiSession: (selector) => useStore(capiSession, selector),
    useIsLoggedIn: () => {
      const v1 = useStore(session, (s) => s.isLoggedIn);
      const v2 = useStore(capiSession, (s) => s.isActive);
      return v1 || v2;
    },
    useSessionHydrated: () => {
      const v1 = useStore(session, (s) => s.hasHydrated);
      const v2 = useStore(capiSession, (s) => s.hasHydrated);
      return v1 && v2;
    },
    hydrate: () => {
      void session.persist.rehydrate();
      void capiSession.persist.rehydrate();
    },
    onAuthEdge: (handlers) => {
      edgeHandlers.push(handlers);
    },
  };
}

export type { Customer, SessionState, SessionStore } from './stores/session';
export type { CapiSessionState, CapiSessionStore } from './stores/capi_session';
export { isAuthError, makeHealAuthIfRejected } from './heal_auth';
export { memoryStorage, type StorageLike } from './storage';
