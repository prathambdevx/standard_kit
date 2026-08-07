import { createHash } from 'node:crypto';
import {
  cached,
  log,
  ServiceUnavailableError,
  ShopifyCustomerAccountError,
  UnauthorizedError,
} from '@devxcommerce/bff-core';
import { Prisma } from '@prisma/client';
import type { MiddlewareHandler } from 'hono';
import { env } from '../config/env';
import { prisma } from '../db/client';
import { getCapiCustomer } from '../services/capi/customer';
import { resolveCapiSession } from '../services/capi/session';
import { deleteCapiSession } from '../services/capi/session_store';

export type Customer = { id: string; name: string; email: string; shopifyId: string };

declare module 'hono' {
  interface ContextVariableMap {
    customer: Customer;
  }
}

// Validate the session at most once a minute per session id — the external
// round-trip dominates; the key is the session id's hash, never the raw id.
const AUTH_CACHE = { softTtl: 60, hardTtl: 60 };

// Resolves a CAPI session id (Authorization: Bearer capi_sess_<uuid>) to a
// local customer row via a real CAPI identity query, upserting on first sight.
// Cached under `auth:capi:` so a repeat request within the cache window skips
// the identity query entirely. Returns null when the session id is unknown/expired.
/** Cache key for a CAPI session's resolved customer. Exported so logout can drop
 *  it — deleting the Redis session alone leaves this cache serving the revoked
 *  id for up to its 60s TTL. */
export function capiAuthCacheKey(sessionId: string): string {
  return `auth:capi:${createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}`;
}

async function resolveCapiCustomer(sessionId: string): Promise<Customer | null> {
  const key = capiAuthCacheKey(sessionId);
  return cached(
    key,
    [],
    async () => {
      const tokenEndpoint = env.CAPI_TOKEN_ENDPOINT;
      if (!tokenEndpoint) {
        throw new ServiceUnavailableError('CAPI_TOKEN_ENDPOINT is not set', {
          code: 'capi_token_endpoint_unconfigured',
        });
      }
      const resolved = await resolveCapiSession({ sessionId, tokenEndpoint });
      if (!resolved) return null;
      // resolveCapiSession only checks the LOCALLY recorded expiry — a customer
      // who signs out directly on Shopify's own checkout/account domain revokes
      // the session server-side immediately, with our copy still looking fresh.
      // Same graceful-degradation call as resolveCapiSession's own refresh-
      // rejected branch (see its comment): a live 401 here means Shopify killed
      // this session out-of-band, so it's dead, not an outage — delete it and
      // drop to guest instead of letting it 502 every authed request forever.
      let sc: Awaited<ReturnType<typeof getCapiCustomer>>;
      try {
        sc = await getCapiCustomer(resolved.accessToken);
      } catch (err) {
        if (err instanceof ShopifyCustomerAccountError && err.code === 'customer_token_expired') {
          // No explicit capiAuthCacheKey delete needed here, unlike logout's —
          // logout deletes it from OUTSIDE any in-flight cached() call for that
          // key; this code runs INSIDE that call's own callback, so cached()
          // caches whatever we return (null) right after we return it, achieving
          // the same negative-cache outcome automatically (verified: a manual
          // del() here gets immediately overwritten by that same write).
          // Best-effort: a failed session-delete must not turn a correct 401
          // into a 502 — the client healing on this response is what matters,
          // not whether the dead record's removal succeeded this exact moment.
          try {
            await deleteCapiSession(sessionId);
          } catch (cleanupErr) {
            log.warn(
              { err: cleanupErr, sessionId: createHash('sha256').update(sessionId).digest('hex').slice(0, 32) },
              'failed to delete revoked CAPI session',
            );
          }
          return null;
        }
        throw err;
      }
      if (!sc) return null;
      const customer =
        (await prisma().customer.findUnique({ where: { shopifyId: sc.shopifyId } })) ??
        (await prisma()
          .customer.upsert({
            where: { email: sc.email },
            create: { shopifyId: sc.shopifyId, name: sc.name, email: sc.email },
            update: { shopifyId: sc.shopifyId, name: sc.name },
          })
          .catch(async (err) => {
            // Two first-hit requests for the same brand-new customer can both
            // pass findUnique before either commits; the loser refetches the
            // winner's row instead of failing.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              const winner = await prisma().customer.findUnique({
                where: { shopifyId: sc.shopifyId },
              });
              if (winner) return winner;
            }
            throw err;
          }));
      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        shopifyId: customer.shopifyId ?? sc.shopifyId,
      };
    },
    AUTH_CACHE,
  );
}

// Gates customer-scoped routes on a valid CAPI session id, sent as
// `Authorization: Bearer capi_sess_<uuid>`.
//
// If your app also accepts some OTHER bearer credential shape on this same
// header (a different login path you built separately), branch on a prefix
// the same way `capiAuthCacheKey`'s caller does — resolve each kind through
// its own function, cached under its own key prefix, so the two can never
// collide even though both ultimately hash their credential the same way.
export const requireCustomer: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new UnauthorizedError('Sign in to continue', { code: 'auth_required' });

  const customer = await resolveCapiCustomer(token);
  if (!customer) {
    throw new UnauthorizedError('Session expired — sign in again', { code: 'auth_invalid' });
  }

  c.set('customer', customer);
  await next();
};
