// Browser-bound secret for the v2 CAPI login handoff. Proves the browser
// completing a claim/grant is the SAME one that started it — without this, a
// relayed claim-token URL logs the opener into whoever's session the token
// actually belongs to. Mandatory, not optional — see ../README.md's
// "browser-binding secret must be mandatory" note for why a missing hash
// must be REFUSED server-side, never silently passed.
//
// sessionStorage, not a cookie: a cookie binding the cross-origin claim POST
// would need SameSite=None, which local/tunnel dev setups drop — making the
// control untestable in the only environments it can actually be exercised
// in. sessionStorage survives the full-page Shopify redirect round trip but
// not a new tab, which is exactly the boundary that matters here.

const SECRET_KEY = 'capi-bind-secret';

/** Raw secret for the claim request body — same value getBindHash last hashed. */
export function getBindSecret(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SECRET_KEY);
}

// A fresh secret every time a grant is minted — reusing one across sequential
// logins in the same tab would let a later attempt's bind hash also match an
// earlier, still-unconsumed grant (the exact takeover this binding closes).
/** SHA-256 hex digest of a newly-minted bound secret — send as the bind-hash header on whichever call mints the grant. */
export async function getBindHash(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const secret = crypto.randomUUID();
  sessionStorage.setItem(SECRET_KEY, secret);
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    // Don't leave an orphaned secret behind — no hash was ever sent for it,
    // so it can't match anything server-side. Only clear it if a later call
    // hasn't already overwritten it with its own fresh secret in the meantime.
    if (sessionStorage.getItem(SECRET_KEY) === secret) {
      sessionStorage.removeItem(SECRET_KEY);
    }
    throw error;
  }
}

/** Drops the secret once a login completes (or fails) so it isn't reused by an unrelated later login. */
export function clearBindSecret(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SECRET_KEY);
}
