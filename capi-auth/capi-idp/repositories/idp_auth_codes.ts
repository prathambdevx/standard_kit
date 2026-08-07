// Single-use Shopify authorization codes live in Redis,
// not Postgres — same reasoning as idp_interactions.ts: this is short-lived,
// single-use state, and a Redis key TTL replaces the old hand-rolled
// CODE_TTL_MS check outright (Redis deletes it; nothing has to read an
// expired row and notice).
import { redis } from '@devxcommerce/bff-core';

const CODE_TTL_SECONDS = 10 * 60;

const codeKey = (code: string) => `capiauth:idp_auth_code:${code}`;

export type IdpAuthCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeChallenge: string | null;
  sub: string;
  email: string;
  createdAt: Date;
};

type SaveInput = {
  code: string;
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeChallenge?: string;
  sub: string;
  email: string;
};

export async function saveCode(input: SaveInput): Promise<void> {
  const fields: Record<string, string> = {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    nonce: input.nonce,
    sub: input.sub,
    email: input.email,
    createdAt: String(Date.now()),
  };
  if (input.codeChallenge) fields.codeChallenge = input.codeChallenge;
  const key = codeKey(input.code);
  await redis().hset(key, fields);
  await redis().expire(key, CODE_TTL_SECONDS);
}

// HGETALL + DEL in one script so a code can never be redeemed twice, even by
// two concurrent /token requests racing on the same code.
const TAKE_SCRIPT = `
local rec = redis.call('HGETALL', KEYS[1])
if #rec == 0 then return nil end
redis.call('DEL', KEYS[1])
return rec
`;

/** Single-use: deletes on read regardless of age, so a code can never be
 *  redeemed twice even if the caller ignores an expired result. The age
 *  check below is defense in depth alongside the key TTL, matching
 *  idp_interactions.ts — kept in case a TTL was ever set wrong. */
export async function takeCode(code: string): Promise<IdpAuthCode | null> {
  const flat = (await redis().eval(TAKE_SCRIPT, 1, codeKey(code))) as string[] | null;
  if (!flat) return null;
  const fields: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) fields[flat[i] as string] = flat[i + 1] as string;
  const row: IdpAuthCode = {
    code,
    clientId: fields.clientId ?? '',
    redirectUri: fields.redirectUri ?? '',
    nonce: fields.nonce ?? '',
    codeChallenge: fields.codeChallenge ?? null,
    sub: fields.sub ?? '',
    email: fields.email ?? '',
    createdAt: new Date(Number(fields.createdAt)),
  };
  if (Date.now() - row.createdAt.getTime() > CODE_TTL_SECONDS * 1000) return null;
  return row;
}
