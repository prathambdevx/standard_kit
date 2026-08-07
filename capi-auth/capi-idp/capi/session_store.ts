// Redis-backed store for Shopify CAPI (Customer Account API) token pairs,
// keyed by an opaque session id — the id the frontend actually holds
// (packages/commerce/src/auth/capi_session.ts). The real Shopify
// access/refresh/id tokens never leave the BFF.
//
// Deliberately its own module, not a reuse of services/idp/session_store.ts.
// That module's `capiauth:session:<id>` namespace was scoped to our own OIDC
// IdP (Shopify as relying party, us as authorization server) and is
// currently unwired/unused everywhere outside its own tests — reusing its
// name and key prefix here would conflate two opposite token directions
// (tokens we issue to Shopify vs. tokens Shopify's CAPI issues to us) under
// one ambiguous "session" concept. A distinct, CAPI-specific namespace costs
// a little duplicated Redis boilerplate but keeps the two concerns legible.

import { randomUUID } from 'node:crypto';
import { redis } from '@devxcommerce/bff-core';

// A CAPI session lives as long as its refresh token is honored — matches
// services/idp/session_store.ts's own refresh-token-backed session lifetime.
const CAPI_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const capiSessionKey = (id: string) => `capiauth:capi_session:${id}`;

export interface CapiSessionRecord {
  accessToken: string;
  refreshToken: string;
  idToken?: string; // only present after an authorization_code grant, not every refresh
  expiresAt: number; // epoch seconds
}

export async function createCapiSession(rec: CapiSessionRecord): Promise<string> {
  const id = `capi_sess_${randomUUID()}`;
  await redis().set(capiSessionKey(id), JSON.stringify(rec), 'EX', CAPI_SESSION_TTL_SECONDS);
  return id;
}

export async function getCapiSession(id: string): Promise<CapiSessionRecord | null> {
  const raw = await redis().get(capiSessionKey(id));
  return raw ? (JSON.parse(raw) as CapiSessionRecord) : null;
}

// Overwrites in place under the SAME id — the frontend's session id must
// never change across a refresh (that guarantee is the point of this store).
export async function updateCapiSession(id: string, rec: CapiSessionRecord): Promise<void> {
  await redis().set(capiSessionKey(id), JSON.stringify(rec), 'EX', CAPI_SESSION_TTL_SECONDS);
}

export async function deleteCapiSession(id: string): Promise<void> {
  await redis().del(capiSessionKey(id));
}

// A short-lived, single-use pointer to a real session id — the callback
// redirect carries this instead of the session id itself, so a 30-day bearer
// credential never lands in a URL (browser history, access logs, Referer
// leakage). The frontend trades it for the real id via one immediate fetch.
const CLAIM_TOKEN_TTL_SECONDS = 5 * 60;

const claimKey = (token: string) => `capiauth:capi_claim:${token}`;

export async function createClaimToken(sessionId: string, bindHash?: string): Promise<string> {
  const token = `capi_claim_${randomUUID()}`;
  await redis().set(
    claimKey(token),
    JSON.stringify({ sessionId, bindHash }),
    'EX',
    CLAIM_TOKEN_TTL_SECONDS,
  );
  return token;
}

export interface ClaimedSession {
  sessionId: string;
  bindHash?: string; // sha256 of the binding cookie set on the browser that completed the CAPI flow
}

// Single-use via Redis's atomic GETDEL — same pattern as idp/session_store.ts's
// takePending. Burning the token even when the caller can't prove the binding is
// deliberate: a relayed token is destroyed rather than left redeemable, and the
// legitimate customer simply logs in again.
export async function consumeClaimToken(token: string): Promise<ClaimedSession | null> {
  const raw = (await redis().call('GETDEL', claimKey(token))) as string | null;
  return raw ? (JSON.parse(raw) as ClaimedSession) : null;
}
