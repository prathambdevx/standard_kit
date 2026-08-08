// Illustrates the two shapes callWithCapiExpiry gets used in, extracted from
// real call sites rather than invented — but with the surrounding
// project-specific logic (order lookups, address CRUD, gift cards, etc.)
// stripped out. Not meant to be imported; copy the pattern into your own
// route handlers.

import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { log, NotFoundError, ShopifyCustomerAccountError, UnauthorizedError } from '@devxcommerce/bff-core';
import { env } from '../../config/env';
import { ok } from '../../lib/response';
import { getCapiCustomer } from '../capi/customer';
import { callWithCapiExpiry, resolveCapiSession } from '../capi/session';
import { deleteCapiSession } from '../capi/session_store';

// ── Shape 1: throwing contract ──
// Used by handlers that already throw on any auth failure (address CRUD,
// account, membership, orders — anywhere the route's own error handling
// already expects an exception, not a sentinel value).

function requireCapiSessionId(c: Context): string {
  const header = c.req.header('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!bearer.startsWith('capi_sess_')) {
    throw new UnauthorizedError('Sign in to continue', { code: 'auth_required' });
  }
  return bearer;
}

export async function getAccountHandler(c: Context): Promise<Response> {
  const sessionId = requireCapiSessionId(c);
  const tokenEndpoint = env.CAPI_TOKEN_ENDPOINT;
  if (!tokenEndpoint) throw new NotFoundError('CAPI not configured', { code: 'capi_unconfigured' });

  const resolved = await resolveCapiSession({ sessionId, tokenEndpoint });
  if (!resolved) throw new UnauthorizedError('Session expired', { code: 'auth_invalid' });

  // The wrapper is what turns a server-side Shopify revoke into a clean 401
  // instead of an unhandled 502 — without it, this getCapiCustomer call would
  // throw ShopifyCustomerAccountError straight past this handler's own
  // try/catch (there isn't one) and surface as a raw upstream failure.
  const customer = await callWithCapiExpiry(sessionId, () => getCapiCustomer(resolved.accessToken));
  return ok(c, { customer });
}

// ── Shape 2: return-null contract ──
// Used by a caller whose existing contract is "return null on any failure,
// let the CALLER decide the error" — e.g. a shared cart-identity resolver
// with two call sites that already convert null into their own error.
// Don't reuse the throwing wrapper here; the contract change would ripple
// into both callers. This mirrors callWithCapiExpiry's own logic exactly,
// just resolving to null instead of throwing on the expiry case.

export async function resolveIdentityOrNull(
  sessionId: string,
  tokenEndpoint: string,
): Promise<{ shopifyId: string; email: string | null } | null> {
  const resolved = await resolveCapiSession({ sessionId, tokenEndpoint });
  if (!resolved) return null;

  try {
    return await getCapiCustomer(resolved.accessToken);
  } catch (err) {
    // Only a server-side revoke is "dead, not an outage" — anything else
    // (a genuine Shopify 5xx, a network blip) must keep throwing, or a
    // Shopify wobble would silently drop every customer to guest.
    if (!(err instanceof ShopifyCustomerAccountError) || err.code !== 'customer_token_expired') {
      throw err;
    }
    try {
      await deleteCapiSession(sessionId);
    } catch (cleanupErr) {
      // Best-effort: a failed cleanup must not turn this clean "null" back
      // into a throw — and never log the raw session id, it's a bearer credential.
      log.warn(
        { err: cleanupErr, sessionId: createHash('sha256').update(sessionId).digest('hex').slice(0, 32) },
        'failed to delete revoked CAPI session',
      );
    }
    return null;
  }
}
