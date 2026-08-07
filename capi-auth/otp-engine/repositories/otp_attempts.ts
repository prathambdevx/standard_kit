// Per-challenge verify budget. Redis, not Postgres, for the
// same reason as otp_challenges.ts: this is 5-minute ephemeral state, and a
// table with no native expiry grew a row per OTP send forever. Kept as its own
// key rather than merged into the challenge hash so the callers' signatures stay
// exactly as they were.
import { redis } from '@devxcommerce/bff-core';

// Same generous flat TTL as the challenge key — see otp_challenges.ts. Nothing
// reads this budget past the challenge's own expiry check, so the TTL is purely
// cleanup.
const OTP_KEY_TTL_SECONDS = 30 * 60;

const attemptKey = (otpId: string) => `capiauth:otp_attempt:${otpId}`;

/** Reset (or create) the attempts record for a fresh/resent challenge. Always
 *  zeroes attempts — a resend must not inherit a prior attempt count. */
export async function resetAttempts(otpId: string, expiresAt: Date): Promise<void> {
  const key = attemptKey(otpId);
  await redis().hset(key, { attempts: '0', expiresAt: String(expiresAt.getTime()) });
  await redis().expire(key, OTP_KEY_TTL_SECONDS);
}

export type AttemptClaim =
  | { ok: true; attempts: number } // this guess is within budget; `attempts` counts it
  | { ok: false; reason: 'unknown' | 'locked' };

// Sentinels, so one round trip can report all three outcomes. Any other return
// is the post-increment attempt count.
const CLAIM_UNKNOWN = -1;
const CLAIM_LOCKED = -2;

// Read-then-check-then-increment let N concurrent verifies all observe 0 and all
// test a different code, so the cap was bounded by client parallelism rather
// than by maxAttempts — brute-forcing a 6-digit code inside its TTL. Redis runs
// a script to completion with nothing interleaved, so the check and the
// increment cannot be split: exactly maxAttempts claims can ever succeed, no
// matter how many arrive at once. A bare INCR would not do — it can overshoot
// the cap and cannot distinguish a never-minted budget from a spent one.
const CLAIM_SCRIPT = `
local attempts = redis.call('HGET', KEYS[1], 'attempts')
if attempts == false then return ${CLAIM_UNKNOWN} end
if tonumber(attempts) >= tonumber(ARGV[1]) then return ${CLAIM_LOCKED} end
return redis.call('HINCRBY', KEYS[1], 'attempts', 1)
`;

/** Atomically spends one attempt from the budget, or refuses. */
export async function claimAttempt(otpId: string, maxAttempts: number): Promise<AttemptClaim> {
  const result = (await redis().eval(
    CLAIM_SCRIPT,
    1,
    attemptKey(otpId),
    String(maxAttempts),
  )) as number;
  // Distinguish "never minted" from "budget spent" — only the latter is a lockout.
  if (result === CLAIM_UNKNOWN) return { ok: false, reason: 'unknown' };
  if (result === CLAIM_LOCKED) return { ok: false, reason: 'locked' };
  return { ok: true, attempts: result };
}

const REFUND_SCRIPT = `
local attempts = redis.call('HGET', KEYS[1], 'attempts')
if attempts == false or tonumber(attempts) <= 0 then return 0 end
return redis.call('HINCRBY', KEYS[1], 'attempts', -1)
`;

/** Gives back an attempt claimed for a guess that was never actually judged —
 *  e.g. the upstream verifier 500'd. Without this an outage silently eats the
 *  customer's 5 guesses. Floors at 0 so it can never go negative. */
export async function refundAttempt(otpId: string): Promise<void> {
  await redis().eval(REFUND_SCRIPT, 1, attemptKey(otpId));
}

/** Drop the attempts record once a challenge is consumed or explicitly discarded. */
export async function deleteAttempts(otpId: string): Promise<void> {
  await redis().del(attemptKey(otpId));
}
