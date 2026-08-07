// OTP challenge state lives in Redis, not Postgres: it is
// 5-minute ephemeral state, and apps/bff/CLAUDE.md's invariant #6 puts that in
// Redis. Postgres has no native expiry, so the old otp_challenges table grew
// one row per OTP send forever and needed a scheduled cleanup script to stay
// bounded. A key TTL makes that class of bug structurally impossible.
//
// No Prisma model backs this anymore (dropped in the same migration that moved
// this off Postgres) — the type below is a plain structural shape, not a
// generated one, so callers keep the exact same fields as before the move.

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

const TAKE_SCRIPT = `
local rec = redis.call('HGETALL', KEYS[1])
if #rec == 0 then return nil end
redis.call('DEL', KEYS[1])
return rec
`;

/** Atomic claim for signup: deletes the key so a concurrent duplicate submit
 *  (double-tap, client retry on a flaky connection) finds nothing to work
 *  with, rather than racing to createShopifyCustomer with the same identity —
 *  the read and the delete run inside one script, so exactly one concurrent
 *  caller can come away with the record.
 *  Call this BEFORE creating the Shopify customer, not after: a delete placed
 *  at the end of the flow is cleanup, not a lock. There is no way back once
 *  this returns non-null, so the caller must be past every other check first. */
export async function takeChallenge(otpId: string): Promise<OtpChallenge | null> {
  const flat = (await redis().eval(TAKE_SCRIPT, 1, challengeKey(otpId))) as string[] | null;
  return flat ? decodeFlat(otpId, flat) : null;
}
