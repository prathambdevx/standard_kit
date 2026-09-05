import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

// The request id lives on the Hono context, which a service function deep in the
// call tree cannot reach. Without this, a log emitted down there (an OTP metric,
// an upstream-failure alert) has no request id and cannot be joined to the
// request that caused it — which is how a failed login becomes untraceable.
//
// Mount `requestContextMiddleware` after whatever sets `requestId` on the context.
export type RequestContext = {
  requestId: string;
  method: string;
  route: string;
  path: string;
};

const store = new AsyncLocalStorage<Context>();

/**
 * The low-cardinality route template. Read lazily — inside a global `app.use('*')`
 * middleware Hono has not matched the route yet (routePath would be `*`), and the
 * getter throws outright on an unmatched route.
 */
function routeOf(c: Context): string {
  try {
    return c.req.routePath;
  } catch {
    return c.req.path;
  }
}

/** The current request's context, or undefined off-request (scripts, boot, jobs). */
export function requestContext(): RequestContext | undefined {
  const c = store.getStore();
  if (!c) return undefined;
  return {
    requestId: c.get('requestId') ?? 'unknown',
    method: c.req.method,
    route: routeOf(c),
    path: c.req.path,
  };
}

/**
 * Makes the request reachable from the whole handler tree. Mount AFTER core's
 * `requestId` middleware — the id it sets is read on access, not now.
 */
export const requestContextMiddleware = createMiddleware(async (c, next) => {
  await store.run(c, next);
});
