// Keeps the login page's ?redirect= alive across the v2 login, which leaves the site entirely
// (full-page walk to Shopify), so in-memory state dies before the callback lands.
// sessionStorage is same-tab, which is exactly right: the walk returns in the same tab.
const REDIRECT_STASH_KEY = 'capi-login-redirect';

// Same-origin paths only. A "//host" or "/\host" value would be an open redirect.
const sanitizeRedirect = (raw: string | null): string | null =>
  raw && /^\/(?![/\\])/.test(raw) ? raw : null;

/** Call on login page mount with the ?redirect= value. No target CLEARS the stash, so a plain
 *  login cannot be hijacked to a destination left over from an earlier abandoned one. */
export function stashLoginRedirect(raw: string | null): void {
  try {
    const target = sanitizeRedirect(raw);
    if (target) sessionStorage.setItem(REDIRECT_STASH_KEY, target);
    else sessionStorage.removeItem(REDIRECT_STASH_KEY);
  } catch {
    // Storage blocked: the login still works, it just lands on the default page.
  }
}

/** One-shot read for the CAPI callback: returns the stashed target and clears it, so a finished
 *  login can never leave a stale destination behind for a later one. */
export function takeLoginRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(REDIRECT_STASH_KEY);
    sessionStorage.removeItem(REDIRECT_STASH_KEY);
    return sanitizeRedirect(raw);
  } catch {
    return null;
  }
}
