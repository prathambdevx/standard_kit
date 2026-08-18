// Sessions, refresh tokens, and in-flight OAuth handshake state for the
// custom OIDC IdP. Deliberately not an in-memory Map — that vanishes on
// restart and doesn't work across more than one instance. All of this is
// ephemeral, TTL-bound state, so it belongs in Redis, not Postgres.

import { redis } from '@devxcommerce/bff-core';

// Sessions/refresh tokens live as long as a refresh token is reasonably
// allowed to; pending OAuth state only needs to survive one redirect round-trip.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PENDING_TTL_SECONDS = 10 * 60; // matches the IdP interaction TTL

const pendingKey = (state: string) => `capiauth:pending:${state}`;
const refreshKey = (token: string) => `capiauth:refresh:${token}`;

export interface PendingAuth {
  codeVerifier: string;
  redirectUri: string;
  bindHash?: string; // carried from the silent grant through to the claim token
  // The silent-grant token this handshake was started for, kept so the callback
  // can verify the IdP actually consumed it. Shopify short-circuits /authorize
  // when it already holds a customer-account session — it never calls you, the
  // grant survives untouched, and the code it returns is for whoever it already
  // had rather than the customer who just passed OTP. See the README's
  // session-reuse note.
  grantToken?: string;
}

export async function putPending(state: string, data: PendingAuth): Promise<void> {
  await redis().set(pendingKey(state), JSON.stringify(data), 'EX', PENDING_TTL_SECONDS);
}

/** Single-use via Redis's atomic GETDEL (Redis 7, no read-then-delete race). */
export async function takePending(state: string): Promise<PendingAuth | null> {
  const raw = (await redis().call('GETDEL', pendingKey(state))) as string | null;
  return raw ? (JSON.parse(raw) as PendingAuth) : null;
}

export interface RefreshTokenRecord {
  clientId: string;
  sub: string;
  email: string | null;
}

export async function saveRefresh(token: string, rec: RefreshTokenRecord): Promise<void> {
  await redis().set(refreshKey(token), JSON.stringify(rec), 'EX', SESSION_TTL_SECONDS);
}

export async function getRefresh(token: string): Promise<RefreshTokenRecord | null> {
  const raw = await redis().get(refreshKey(token));
  return raw ? (JSON.parse(raw) as RefreshTokenRecord) : null;
}

export async function deleteRefresh(token: string): Promise<void> {
  await redis().del(refreshKey(token));
}

// Single-use pointer from the silent-CAPI-handoff cookie to the customer who just verified OTP.
const SILENT_GRANT_TTL_SECONDS = 5 * 60;

const silentGrantKey = (token: string) => `capiauth:silent_grant:${token}`;

export interface SilentGrant {
  shopifyId: string;
  email: string;
  bindHash?: string; // sha256 of the binding cookie set on the browser that earned this grant
}

export async function putSilentGrant(token: string, data: SilentGrant): Promise<void> {
  await redis().set(silentGrantKey(token), JSON.stringify(data), 'EX', SILENT_GRANT_TTL_SECONDS);
}

/** Single-use via Redis's atomic GETDEL — same pattern as takePending. */
export async function takeSilentGrant(token: string): Promise<SilentGrant | null> {
  const raw = (await redis().call('GETDEL', silentGrantKey(token))) as string | null;
  return raw ? (JSON.parse(raw) as SilentGrant) : null;
}

// Non-consuming existence check — lets startCapiAuthorizeHandler validate a
// grant before committing to the Shopify round-trip without burning its one
// use; the real single-use consumption stays in authorizeHandler via takeSilentGrant.
export async function peekSilentGrant(token: string): Promise<SilentGrant | null> {
  const raw = (await redis().get(silentGrantKey(token))) as string | null;
  return raw ? (JSON.parse(raw) as SilentGrant) : null;
}
