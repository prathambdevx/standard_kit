// Auth — the pieces shared by more than one of this module's handler files
// (otp_handlers, idp_handlers, capi_handlers). Anything used by a single
// category lives in that category's own file instead.
import type { Context } from 'hono';

export const INTERACTION_COOKIE = 'idp_interaction';
// Carries the silent-CAPI-handoff grant (see respondWithCustomerSession /
// authorizeHandler below) — a completely separate concern from
// INTERACTION_COOKIE even though both are short-lived httpOnly cookies on
// this same /idp/authorize endpoint.
export const SILENT_GRANT_COOKIE = 'idp_silent_grant';

// Must match session_store.ts's own SILENT_GRANT_TTL_SECONDS.
export const SILENT_GRANT_COOKIE_MAX_AGE_SECONDS = 5 * 60;

export function bffBaseUrl(c: Context): string {
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'localhost';
  return `${proto}://${host}`;
}

export function issuer(c: Context): string {
  return `${bffBaseUrl(c)}/auth/idp`;
}

export function missingCapiConfig(...vars: (string | undefined)[]): boolean {
  return vars.some((v) => !v);
}
