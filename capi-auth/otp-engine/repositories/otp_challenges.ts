// OTP challenge state lives in Redis, not Postgres: it is
// 5-minute ephemeral state, and apps/bff/CLAUDE.md's invariant #6 puts that in
// Redis. Postgres has no native expiry, so the old otp_challenges table grew
// one row per OTP send forever and needed a scheduled cleanup script to stay
// bounded. A key TTL makes that class of bug structurally impossible.
//
// No Prisma model backs this anymore (dropped in the same migration that moved
// this off Postgres) — the type below is a plain structural shape, not a
// generated one, so callers keep the exact same fields as before the move.

import { randomUUID } from 'node:crypto';
import { redis } from '@devxcommerce/bff-core';

export type OtpChallenge = {
  otpId: string;
  username: string;
  channel: string;
  codeHash: string;
  expiresAt: Date;
  consumed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// Generously longer than OTP_TTL_MS on purpose: the TTL is cleanup, never
// correctness. An EXPIRED challenge must stay READABLE so verifyOtp can return
// `otp_expired` rather than `otp_not_found` (two different customer-facing
// messages), and a CONSUMED one must survive the 5-minute
// DETAILS_SUBMISSION_WINDOW_MS the signup details form runs on. `expiresAt`
// inside the record is the only authoritative expiry check.
const OTP_KEY_TTL_SECONDS = 30 * 60;

const challengeKey = (otpId: string) => `capiauth:otp_challenge:${otpId}`;

type CreateInput = {
  otpId: string;
  username: string;
  channel: string;
  codeHash: string;
  expiresAt: Date;
};

// Redis hashes are string-only, so every Date crosses as epoch millis and
// `consumed` as '0'/'1'.
function decode(otpId: string, fields: Record<string, string>): OtpChallenge {
  return {
    otpId,
    username: fields.username ?? '',
    channel: fields.channel ?? '',
    codeHash: fields.codeHash ?? '',
    expiresAt: new Date(Number(fields.expiresAt)),
    consumed: fields.consumed === '1',
    createdAt: new Date(Number(fields.createdAt)),
    updatedAt: new Date(Number(fields.updatedAt)),
  };
}

/** Lua HGETALL comes back as a flat [field, value, ...] array, not an object. */
function decodeFlat(otpId: string, flat: string[]): OtpChallenge {
  const fields: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) fields[flat[i] as string] = flat[i + 1] as string;
  return decode(otpId, fields);
}

export async function createChallenge(input: CreateInput): Promise<OtpChallenge> {
  const now = Date.now();
  const fields = {
    username: input.username,
    channel: input.channel,
    codeHash: input.codeHash,
    expiresAt: String(input.expiresAt.getTime()),
    consumed: '0',
    createdAt: String(now),
    updatedAt: String(now),
  };
  const key = challengeKey(input.otpId);
  await redis().hset(key, fields);
  await redis().expire(key, OTP_KEY_TTL_SECONDS);
  return decode(input.otpId, fields);
}

export async function getChallenge(otpId: string): Promise<OtpChallenge | null> {
  const fields = await redis().hgetall(challengeKey(otpId));
  // ioredis returns {} rather than null for a missing hash.
  if (!fields || Object.keys(fields).length === 0) return null;
  return decode(otpId, fields);
}

// Every mutation below is a Lua script for the same two reasons: it must not
// resurrect a challenge that was deleted/expired out from under it (a bare HSET
// would happily create a half-populated hash with no username or createdAt),
// and `updatedAt` has to move in the same step as whatever it timestamps.

/** nil when the key is gone, so the caller can mirror Prisma's not-found throw. */
const RESET_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
redis.call('HSET', KEYS[1], 'codeHash', ARGV[1], 'expiresAt', ARGV[2], 'consumed', '0', 'updatedAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return redis.call('HGETALL', KEYS[1])
`;

/** Resend: same otpId, fresh code/expiry, un-consumed. */
export async function resetChallenge(
  otpId: string,
  codeHash: string,
  expiresAt: Date,
): Promise<OtpChallenge> {
  const flat = (await redis().eval(
    RESET_SCRIPT,
    1,
    challengeKey(otpId),
    codeHash,
    String(expiresAt.getTime()),
    String(Date.now()),
    String(OTP_KEY_TTL_SECONDS),
  )) as string[] | null;
  if (!flat) throw new Error(`OTP challenge ${otpId} no longer exists`);
  return decodeFlat(otpId, flat);
}

const TOUCH_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

/** Bumps updatedAt with no other effect — arms the resend cooldown ahead of a
 *  send that might throw, so a failing gateway can't be hammered by immediate
 *  retries once checkOtpSendRateLimit's own cap is the only thing stopping them.
 *  updatedAt is real behavior here, not bookkeeping: Prisma's `@updatedAt` used
 *  to maintain it, so in Redis it must be written explicitly on every mutation.
 *  A no-op on an unknown otpId, matching the old updateMany. */
export async function touchChallenge(otpId: string): Promise<void> {
  await redis().eval(
    TOUCH_SCRIPT,
    1,
    challengeKey(otpId),
    String(Date.now()),
    String(OTP_KEY_TTL_SECONDS),
  );
}

// The EXPIRE refresh is load-bearing, not tidiness: submitOtpDetailsHandler
// measures its 5-minute DETAILS_SUBMISSION_WINDOW_MS from this updatedAt, so the
// record has to outlive consumption by at least that long or signup breaks for
// anyone who pauses on the details form.
const CONSUME_SCRIPT = `
if redis.call('HGET', KEYS[1], 'consumed') ~= '0' then return 0 end
redis.call('HSET', KEYS[1], 'consumed', '1', 'updatedAt', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

/** Marks the challenge consumed, returning false if someone already did.
 *  Atomic so two concurrent verifies of the same correct code can't both win
 *  and mint two sessions — an unconditional write let both through. */
export async function markConsumed(otpId: string): Promise<boolean> {
  const claimed = (await redis().eval(
    CONSUME_SCRIPT,
    1,
    challengeKey(otpId),
    String(Date.now()),
    String(OTP_KEY_TTL_SECONDS),
  )) as number;
  return claimed === 1;
}

export async function deleteChallenge(otpId: string): Promise<void> {
  await redis().del(challengeKey(otpId));
}

// How long a signup claim is honoured before another attempt may take it over.
// Bounds the damage if a process dies mid-signup: without it, an in-flight
// stamp that nothing ever clears would lock the customer out of their own
// signup for the key's whole remaining TTL. Comfortably longer than the
// downstream customer-create round trip it guards.
const SIGNUP_CLAIM_TTL_MS = 30 * 1000;

export type SignupClaim = { challenge: OtpChallenge; claimToken: string };

// Stamps an in-flight marker instead of deleting. Returns the record as it was
// BEFORE the stamp, so the caller still reads the real username/channel/createdAt.
// The token is what makes the release ownership-checked: once the stamp ages past
// SIGNUP_CLAIM_TTL_MS a second attempt may take the claim over, and without a token
// the first attempt's late release would clear the SECOND one's marker, letting a
// third in while that one is still mid-customer-create.
const CLAIM_SIGNUP_SCRIPT = `
local rec = redis.call('HGETALL', KEYS[1])
if #rec == 0 then return nil end
local inflight = redis.call('HGET', KEYS[1], 'signupAt')
if inflight and (tonumber(ARGV[1]) - tonumber(inflight)) < tonumber(ARGV[2]) then return nil end
redis.call('HSET', KEYS[1], 'signupAt', ARGV[1], 'signupToken', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return rec
`;

/** Atomic claim for signup: marks the challenge in-flight so a concurrent
 *  duplicate submit (double-tap, client retry on a flaky connection) can't
 *  race to createShopifyCustomer with the same identity — the read and the
 *  stamp run inside one script, so exactly one concurrent caller wins.
 *
 *  Deliberately NOT a delete. Deleting made the claim irreversible, so ANY
 *  downstream failure (a duplicate email, a typo'd field, an upstream hiccup)
 *  stranded the customer: the details form could only answer `otp_not_verified`
 *  on a retry, and going back to resend answered `otp_not_found`, because the
 *  record backing both was already gone. The caller deletes on SUCCESS
 *  (consumeSignupClaim) and calls releaseSignupClaim on failure. */
export async function claimChallengeForSignup(otpId: string): Promise<SignupClaim | null> {
  const claimToken = randomUUID();
  const flat = (await redis().eval(
    CLAIM_SIGNUP_SCRIPT,
    1,
    challengeKey(otpId),
    String(Date.now()),
    String(SIGNUP_CLAIM_TTL_MS),
    String(OTP_KEY_TTL_SECONDS),
    claimToken,
  )) as string[] | null;
  return flat ? { challenge: decodeFlat(otpId, flat), claimToken } : null;
}

// Deliberately leaves updatedAt alone: submitOtpDetailsHandler measures its
// 5-minute DETAILS_SUBMISSION_WINDOW_MS from it, so bumping it here would hand
// out a fresh window on every failed attempt, indefinitely.
// A missing key HGETs to `false` in Lua, which never equals the token string, so
// the ownership check covers the deleted-key case without a separate EXISTS.
const RELEASE_SIGNUP_SCRIPT = `
if redis.call('HGET', KEYS[1], 'signupToken') ~= ARGV[1] then return 0 end
redis.call('HDEL', KEYS[1], 'signupAt', 'signupToken')
return 1
`;

/** Undoes claimChallengeForSignup after a failed create, so the customer can
 *  fix their input and resubmit (or go back and resend) on the same challenge.
 *  A no-op unless `claimToken` still owns the claim — a late release from a
 *  timed-out attempt must not clear whichever attempt holds it now. */
export async function releaseSignupClaim(otpId: string, claimToken: string): Promise<void> {
  await redis().eval(RELEASE_SIGNUP_SCRIPT, 1, challengeKey(otpId), claimToken);
}

const CONSUME_SIGNUP_SCRIPT = `
if redis.call('HGET', KEYS[1], 'signupToken') ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

/** Deletes the challenge once its signup has actually created the customer.
 *  Ownership-checked for the same reason releaseSignupClaim is: a first
 *  attempt that overran its lease and then succeeded must not delete a
 *  challenge a SECOND attempt has since claimed and is still working on.
 *  Returns false when the lease was lost, which the caller logs rather than
 *  fails on — the customer was created either way. */
export async function consumeSignupClaim(otpId: string, claimToken: string): Promise<boolean> {
  const consumed = (await redis().eval(
    CONSUME_SIGNUP_SCRIPT,
    1,
    challengeKey(otpId),
    claimToken,
  )) as number;
  return consumed === 1;
}
