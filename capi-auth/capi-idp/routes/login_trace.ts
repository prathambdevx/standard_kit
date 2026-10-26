// Login-chain correlator: one id minted at OTP verify, carried through every hop
// (grant, IdP interaction, auth code, CAPI pending, claim token) so one grep finds the login.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    loginTraceId?: string;
  }
}

// Lets code with no Context (otp-engine/metrics.ts) read the id; enterWith scopes it to this request.
const store = new AsyncLocalStorage<{ loginTraceId?: string }>();

export function mintLoginTraceId(): string {
  return `trace_${randomUUID()}`;
}

// No-op when id is undefined, so callers can pass a possibly-absent value straight through.
export function setLoginTraceId(c: Context, id: string | undefined): void {
  if (!id) return;
  c.set('loginTraceId', id);
  store.enterWith({ loginTraceId: id });
}

export function currentLoginTraceId(): string | undefined {
  return store.getStore()?.loginTraceId;
}
