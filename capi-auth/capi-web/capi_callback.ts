// Trades a one-time claim token (from Shopify's CAPI redirect, ADR-0016-style
// flow — see ../capi-idp/routes/capi_handlers.ts's capiCallbackHandler) for
// the real CAPI session id, and stores it. Framework-agnostic: call this from
// wherever your app lands the redirect (a Next.js page effect, a React Router
// loader, whatever) — it does no navigation itself, the caller decides where
// to send the customer next based on the returned result.
import type { CapiSessionStore } from './stores/capi_session';
import type { Customer } from './stores/session';
import type { SessionStore } from './stores/session';

export type ClaimCapiSession = (input: {
  claimToken: string;
  bindSecret: string;
}) => Promise<{ sessionId: string }>;

/** Optional — fetches the customer profile right after claiming, so the UI has
 *  a name/email to show immediately instead of waiting for the next account read. */
export type GetAccountProfile = () => Promise<Customer>;

export type CapiCallbackResult =
  | { ok: true }
  | { ok: false; reason: 'missing_token_or_bind_secret' | 'claim_failed' };

/**
 * Call once per redirect landing (guard re-entry yourself — e.g. a `useRef`
 * in React — since the claim token is single-use and effects can double-fire).
 * `bindSecret` is REQUIRED, never optional (see ./bind_secret.ts's doc comment
 * on why a missing one must refuse rather than silently pass).
 */
export async function exchangeCapiClaim(input: {
  claimToken: string | null;
  bindSecret: string | null;
  claimCapiSession: ClaimCapiSession;
  getAccountProfile?: GetAccountProfile;
  session: SessionStore; // v1 — pass a dummy store if your app is CAPI-only
  capiSession: CapiSessionStore; // v2
}): Promise<CapiCallbackResult> {
  const { claimToken, bindSecret, claimCapiSession, getAccountProfile, session, capiSession } =
    input;
  if (!claimToken || !bindSecret) return { ok: false, reason: 'missing_token_or_bind_secret' };

  try {
    const { sessionId } = await claimCapiSession({ claimToken, bindSecret });
    // Drop any still-live v1 credential first. Most SDKs resolve
    // `customerToken ?? capiSessionId`, so v1 would otherwise win — a leftover
    // token from a different account on a shared device would silently
    // resolve every write to THAT customer while the UI shows this one.
    // Only fires when a v1 token actually exists, so an ordinary v2-only
    // login is untouched.
    if (session.getState().token) session.getState().logout(); // v1
    capiSession.getState().setSession(sessionId); // v2
    // Identity goes on the CAPI store, not v1's: v1 nulls `customer` on every
    // rehydrate when its token is absent, so writing it there means the
    // identity survives until the first reload and no further.
    if (getAccountProfile) {
      try {
        capiSession.getState().setCustomer(await getAccountProfile());
      } catch {
        // Best-effort — the caller's own account read refreshes it later.
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'claim_failed' };
  }
}
