// Pending Shopify authorize-request state lives in Redis,
// not Postgres: it is 10-minute ephemeral state, and apps/bff/CLAUDE.md's
// invariant #6 puts that in Redis. The old Postgres row only cleaned up
// lazily on a re-read past its TTL — an ABANDONED login (customer never
// returns) had nothing to trigger that check, so it stayed forever. A key
// TTL makes that leak structurally impossible instead of depending on a read
// that might never happen.
import { redis } from '@devxcommerce/bff-core';

const INTERACTION_TTL_SECONDS = 10 * 60;

const interactionKey = (id: string) => `capiauth:idp_interaction:${id}`;

export type IdpInteraction = {
  id: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  scope: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  createdAt: Date;
};

type CreateInput = {
  id: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  scope: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

function decode(id: string, fields: Record<string, string>): IdpInteraction {
  return {
    id,
    clientId: fields.clientId ?? '',
    redirectUri: fields.redirectUri ?? '',
    state: fields.state ?? '',
    nonce: fields.nonce ?? '',
    scope: fields.scope ?? '',
    codeChallenge: fields.codeChallenge ?? null,
    codeChallengeMethod: fields.codeChallengeMethod ?? null,
    createdAt: new Date(Number(fields.createdAt)),
  };
}

export async function createInteraction(input: CreateInput): Promise<IdpInteraction> {
  const fields: Record<string, string> = {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    state: input.state,
    nonce: input.nonce,
    scope: input.scope,
    createdAt: String(Date.now()),
  };
  if (input.codeChallenge) fields.codeChallenge = input.codeChallenge;
  if (input.codeChallengeMethod) fields.codeChallengeMethod = input.codeChallengeMethod;
  const key = interactionKey(input.id);
  await redis().hset(key, fields);
  await redis().expire(key, INTERACTION_TTL_SECONDS);
  return decode(input.id, fields);
}

/** Null on missing OR expired. The key TTL is the real enforcement now; the
 *  age check below is defense in depth in case a TTL was ever set wrong, and
 *  keeps this function's contract identical to the old Postgres version. */
export async function getInteraction(id: string | undefined): Promise<IdpInteraction | null> {
  if (!id) return null;
  const fields = await redis().hgetall(interactionKey(id));
  if (!fields || Object.keys(fields).length === 0) return null;
  const row = decode(id, fields);
  if (Date.now() - row.createdAt.getTime() > INTERACTION_TTL_SECONDS * 1000) {
    await deleteInteraction(id);
    return null;
  }
  return row;
}

export async function deleteInteraction(id: string): Promise<void> {
  await redis().del(interactionKey(id));
}
