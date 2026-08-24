// Issuance + resolution of CAPI sessions — the piece that sits between
// token_exchange.ts (talks to Shopify) and the opaque session id your
// frontend actually holds. Service-layer only, no HTTP handling here.

import { createHash } from 'node:crypto';
import { log, ShopifyCustomerAccountError, UnauthorizedError } from '@devxcommerce/bff-core';
import {
  type CapiSessionRecord,
  createCapiSession,
  deleteCapiSession,
  getCapiSession,
  updateCapiSession,
} from './session_store';
import type { CapiClientDeps } from './token_exchange';
import { exchangeAuthorizationCode, exchangeRefreshToken } from './token_exchange';

// A token that expires within this window is functionally already dead for
// a request that takes any time at all — refresh proactively inside this
// window rather than waiting for `expiresAt` to actually pass.
const REFRESH_LEEWAY_SECONDS = 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function isNearExpiry(rec: CapiSessionRecord): boolean {
  return rec.expiresAt <= nowSeconds() + REFRESH_LEEWAY_SECONDS;
}

export interface ResolvedCapiSession {
  sessionId: string;
  accessToken: string;
  idToken?: string;
  expiresAt: number;
}

/** Exchanges a CAPI authorization code for tokens and stores them under a new opaque session id. */
export async function issueCapiSession(input: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  tokenEndpoint: string;
  deps?: CapiClientDeps;
}): Promise<string> {
  const tokens = await exchangeAuthorizationCode({
    code: input.code,
    redirectUri: input.redirectUri,
    codeVerifier: input.codeVerifier,
    tokenEndpoint: input.tokenEndpoint,
    deps: input.deps,
  });

  // Without a refresh token there is nothing for resolveCapiSession to renew
  // later — this would be a Shopify CAPI registration/grant mismatch, not a
  // normal runtime condition, so a plain Error is fine (no request boundary
  // exists yet to map it to an AppError).
  if (!tokens.refresh_token) {
    throw new Error('Shopify CAPI did not return a refresh_token on the authorization_code grant');
  }

  return createCapiSession({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: nowSeconds() + tokens.expires_in,
  });
}

/** True when Shopify actively REJECTED the refresh token (4xx) rather than failing to answer (5xx/network).
 *  upstreamFetch puts the HTTP status on `cause.status`; anything else is treated as an outage. */
function isRefreshRejected(err: unknown): boolean {
  const cause = (err as { cause?: { status?: unknown } } | null)?.cause;
  const status = cause?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** Resolves a session id to a live access token, refreshing in place if needed; never rotates the id. */
export async function resolveCapiSession(input: {
  sessionId: string;
  tokenEndpoint: string;
  deps?: CapiClientDeps;
}): Promise<ResolvedCapiSession | null> {
  const rec = await getCapiSession(input.sessionId);
  if (!rec) return null;

  if (!isNearExpiry(rec)) {
    return {
      sessionId: input.sessionId,
      accessToken: rec.accessToken,
      idToken: rec.idToken,
      expiresAt: rec.expiresAt,
    };
  }

  // A refresh that Shopify REJECTS is a dead session, not an outage: the
  // customer revoked the app, changed their password, or signed out elsewhere.
  // Letting that throw made every authed request 502 forever — and 502 isn't an
  // auth error, so the client never healed. The shopper sat in a logged-in UI
  // with writes silently failing and no way out, while the dead row sat there
  // indefinitely. Deleting it and reporting "not resolvable" drops them to
  // guest, which every caller already handles.
  //
  // Only 4xx is treated as dead. A 5xx or a network blip is a genuine outage and
  // must keep throwing, or a Shopify wobble would log out every logged-in customer.
  let refreshed: Awaited<ReturnType<typeof exchangeRefreshToken>>;
  try {
    refreshed = await exchangeRefreshToken({
      refreshToken: rec.refreshToken,
      tokenEndpoint: input.tokenEndpoint,
      deps: input.deps,
    });
  } catch (err) {
    if (!isRefreshRejected(err)) throw err;
    await deleteCapiSession(input.sessionId);
    return null;
  }

  const updated: CapiSessionRecord = {
    accessToken: refreshed.access_token,
    // Shopify may or may not rotate the refresh token on a refresh_token
    // grant — keep the existing one when a new one isn't issued.
    refreshToken: refreshed.refresh_token ?? rec.refreshToken,
    idToken: refreshed.id_token ?? rec.idToken,
    expiresAt: nowSeconds() + refreshed.expires_in,
  };
  await updateCapiSession(input.sessionId, updated);

  return {
    sessionId: input.sessionId,
    accessToken: updated.accessToken,
    idToken: updated.idToken,
    expiresAt: updated.expiresAt,
  };
}

/** Runs a call made with a resolved CAPI access token; on Shopify's live 401
 *  (customer_token_expired — a server-side revoke resolveCapiSession's own
 *  locally-recorded expiry can't see, same case as middleware/customer.ts's
 *  resolveCapiCustomer), deletes the dead session and throws a clean 401
 *  instead of letting the raw ShopifyCustomerAccountError 502. One shared
 *  place for every direct customer/address/membership CAPI call site, rather
 *  than duplicating this catch at each one. */
export async function callWithCapiExpiry<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ShopifyCustomerAccountError && err.code === 'customer_token_expired') {
      try {
        await deleteCapiSession(sessionId);
      } catch (cleanupErr) {
        log.warn(
          {
            err: cleanupErr,
            sessionId: createHash('sha256').update(sessionId).digest('hex').slice(0, 32),
          },
          'failed to delete revoked CAPI session',
        );
      }
      throw new UnauthorizedError('Session expired — sign in again', { code: 'auth_invalid' });
    }
    throw err;
  }
}
