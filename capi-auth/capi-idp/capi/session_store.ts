// Postgres-backed store for Shopify CAPI (Customer Account API) token pairs,
// keyed by an opaque session id — the id the frontend actually holds. The real
// Shopify access/refresh/id tokens never leave the BFF.
//
// Postgres, not Redis, because the record holds a REFRESH token: the session
// outlives any short cache TTL, and losing the row destroys the credential a
// customer re-authenticates with, not merely their session. Redis is still the
// right home for the claim tokens at the bottom of this file — those are
// 5-minute single-use pointers, which is exactly what a TTL store is for.
//
// Deliberately its own module, not a reuse of idp/session_store.ts. That
// module's namespace is scoped to our own OIDC IdP (Shopify as relying party,
// us as authorization server); reusing it here would conflate two opposite
// token directions (tokens we issue to Shopify vs. tokens Shopify's CAPI issues
// to us) under one ambiguous "session" concept.

import { createHash, randomUUID } from 'node:crypto';
import { redis } from '@devxcommerce/bff-core';
import { prisma } from '../db/client';

export interface CapiSessionRecord {
  accessToken: string;
  refreshToken: string;
  idToken?: string; // only present after an authorization_code grant, not every refresh
  expiresAt: number; // epoch seconds
}

// The raw session id is the bearer credential, so only its hash is stored — a
// table dump then yields no replayable sessions.
const storedId = (id: string) => createHash('sha256').update(id).digest('hex');

// The id_token's `sub` is the customer id, so no Shopify call is needed. GID form
// to match however you store the customer id elsewhere — see the README.
function customerGidFromIdToken(jwt: string | undefined): string | null {
  if (!jwt) return null;
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const { sub } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
    return sub ? `gid://shopify/Customer/${sub}` : null;
  } catch {
    // A malformed id_token must never fail session creation — this column is
    // for operator lookups, not for auth.
    return null;
  }
}

// epoch seconds on the record, timestamp in the column — converted only here.
// Tokens are stored as Shopify issued them; see the README's note on encryption.
const toRow = (rec: CapiSessionRecord) => {
  const shopifyId = customerGidFromIdToken(rec.idToken);
  return {
    accessToken: rec.accessToken,
    refreshToken: rec.refreshToken,
    idToken: rec.idToken ?? null,
    expiresAt: new Date(rec.expiresAt * 1000),
    // Omitted when unresolvable, never null: an update must not wipe an id a
    // previous write already resolved.
    ...(shopifyId ? { shopifyId } : {}),
  };
};

const fromRow = (row: {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  expiresAt: Date;
}): CapiSessionRecord => ({
  accessToken: row.accessToken,
  refreshToken: row.refreshToken,
  ...(row.idToken ? { idToken: row.idToken } : {}),
  expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
});

export async function createCapiSession(rec: CapiSessionRecord): Promise<string> {
  const id = `capi_sess_${randomUUID()}`;
  await prisma().capiSession.create({ data: { id: storedId(id), ...toRow(rec) } });
  return id;
}

// Only answers "has anyone come back", so second-accuracy is pointless — and
// without the guard every uncached per-request read would fire a row UPDATE.
const TOUCH_AFTER_MS = 60 * 60 * 1000; // 1 hour

const isTouchStale = (lastUsedAt: Date | null): boolean =>
  !lastUsedAt || Date.now() - lastUsedAt.getTime() > TOUCH_AFTER_MS;

export async function getCapiSession(id: string): Promise<CapiSessionRecord | null> {
  const key = storedId(id);
  const row = await prisma().capiSession.findUnique({ where: { id: key } });
  if (!row) return null;
  // Not awaited: a slow or failed touch must not delay or fail the request.
  if (isTouchStale(row.lastUsedAt)) {
    void prisma()
      .capiSession.update({ where: { id: key }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return fromRow(row);
}

// Overwrites in place under the SAME id — the frontend's session id must
// never change across a refresh (that guarantee is the point of this store).
export async function updateCapiSession(id: string, rec: CapiSessionRecord): Promise<void> {
  const key = storedId(id);
  const row = toRow(rec);
  // upsert, not update: a resolve-then-refresh in one pass would otherwise throw
  // if the row was removed concurrently.
  await prisma().capiSession.upsert({
    where: { id: key },
    create: { id: key, ...row, lastUsedAt: new Date() },
    update: { ...row, lastUsedAt: new Date() },
  });
}

export async function deleteCapiSession(id: string): Promise<void> {
  await prisma()
    .capiSession.delete({ where: { id: storedId(id) } })
    // P2025 = already gone, which is the desired end state for a delete.
    .catch((err: { code?: string }) => {
      if (err?.code !== 'P2025') throw err;
    });
}

// A short-lived, single-use pointer to a real session id — the callback
// redirect carries this instead of the session id itself, so a long-lived
// bearer credential never lands in a URL (browser history, access logs, Referer
// leakage). The frontend trades it for the real id via one immediate fetch.
// Redis is correct here: single-use with a 5-minute TTL.
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

// Single-use via Redis's atomic GETDEL. Burning the token even when the caller
// can't prove the binding is deliberate: a relayed token is destroyed rather
// than left redeemable, and the legitimate customer simply logs in again.
export async function consumeClaimToken(token: string): Promise<ClaimedSession | null> {
  const raw = (await redis().call('GETDEL', claimKey(token))) as string | null;
  return raw ? (JSON.parse(raw) as ClaimedSession) : null;
}
