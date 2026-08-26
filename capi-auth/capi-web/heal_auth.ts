// Every store that writes through the BFF on behalf of a logged-in customer
// (cart, wishlist, saved addresses, whatever your app has) needs this pattern
// in its catch block, or a dead session shows successful-looking writes that
// silently never persist — the exact bug this exists to prevent. This is not
// meant to be imported and called generically; copy `healAuthIfRejected`'s
// SHAPE into each store, importing only `isAuthError` from here, because each
// store's `set(...)` on reset (clear cartId, reset items, etc.) is different.
import type { CapiSessionStore } from './stores/capi_session';
import type { SessionStore } from './stores/session';

/** True when the server rejected the session credential (backend switch,
 *  revocation, server-side expiry) — a client-side expiry clock can't detect
 *  this, since a token can be dead well before its stated expiry. */
export const isAuthError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const { status, code } = err as { status?: unknown; code?: unknown };
  return (
    status === 401 ||
    code === 'unauthorized' ||
    code === 'invalid_customer_token' ||
    code === 'login_required'
  );
};

/**
 * Reference shape — copy this into each write-capable store's own module,
 * adjusting the `set(...)` line for whatever that store needs to reset.
 * Both `if`s are independent (not else-if): a customer only ever has ONE of
 * the two sessions live, so whichever check is false is simply a no-op —
 * the other one still runs and correctly clears the session that IS live.
 *
 *   const healAuthIfRejected = (err: unknown) => {
 *     if (!isAuthError(err)) return false;
 *     if (session.getState().token) session.getState().logout();          // v1
 *     if (capiSession.getState().isActive) capiSession.getState().clearSession(); // v2
 *     return true;
 *   };
 *
 * Call it from every catch block a write-through call can land in:
 *
 *   try {
 *     await sdk.wishlist.add(item);
 *   } catch (err) {
 *     if (healAuthIfRejected(err)) return; // session cleared, caller drops to guest UI
 *     throw err; // a genuine failure (network, 500) — don't swallow it
 *   }
 */
export function makeHealAuthIfRejected(session: SessionStore, capiSession: CapiSessionStore) {
  return (err: unknown): boolean => {
    if (!isAuthError(err)) return false;
    if (session.getState().token) session.getState().logout(); // v1
    if (capiSession.getState().isActive) capiSession.getState().clearSession(); // v2
    return true;
  };
}
