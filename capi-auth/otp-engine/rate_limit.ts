// Abuse protection for OTP sends — SMS-pumping fraud triggers OTPs to premium
// numbers to drain spend, so this fails CLOSED on a Redis error (unlike a
// looser rate limiter elsewhere in your app might reasonably fail open for —
// a blip there just delays something non-critical; a blip here would mean
// unlimited SMS spend for as long as Redis is down).
import { redis, TooManyRequestsError } from '@devxcommerce/bff-core';
import { env } from '../../config/env';
import { recordOtpMetric } from './metrics';

// The 30s resend cooldown (packages/commerce's RESEND_SECONDS) is the primary
// throttle against pumping fraud — these are a looser backstop, not the front
// line, so they shouldn't be the thing a customer trips over legitimate
// delivery delays or a few retries.
// Despite the name, this bounds any single username identity — email as much
// as phone (checkOtpSendRateLimit is called with whatever channel the caller
// used; identityKey() just normalizes case, it doesn't branch by channel).
// 5/hour = 1 initial send + 4 resends, matching the industry-standard 3-5/hour
// range for OTP send limits.
const PHONE_HOURLY_MAX = 5;
const PHONE_DAILY_MAX = 10;
// Kept meaningfully above PHONE_HOURLY_MAX (not equal) — one IP is legitimately
// many identities (office WiFi, a shared connection), so an equal cap would
// make the IP limit bind before any single identity's own limit does.
const IP_HOURLY_MAX = 20;
// Verify is capped far above a real customer's need (a legitimate one submits
// once or twice) but far below what brute-forcing a 6-digit code takes. The
// per-challenge budget in claimAttempt is the primary control; this bounds the
// attacker who keeps requesting FRESH challenges to reset that budget.
const VERIFY_IP_HOURLY_MAX = 30;

async function incrementAndCheck(key: string, max: number, ttlSeconds: number): Promise<boolean> {
  const hits = await redis().incr(key);
  // EXPIRE is a second round-trip, so a crash between the two would leave the
  // key TTL-less and (since hits===1 never recurs) permanently un-expiring.
  // NX makes it idempotent, so it can be set on every hit instead of just the first.
  await redis().expire(key, ttlSeconds, 'NX');
  return hits > max;
}

/** Normalizes the rate-limit identity so casing/format variants share one bucket —
 *  `V@x.com` and `v@x.com` are one inbox, and Zod's .email() doesn't canonicalize. */
function identityKey(username: string): string {
  return username.trim().toLowerCase();
}

export async function checkOtpSendRateLimit(phone: string, ip: string): Promise<void> {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const id = identityKey(phone);

  const [phoneHourOver, phoneDayOver, ipHourOver] = await Promise.all([
    incrementAndCheck(`otp:ratelimit:phone:hour:${id}:${hourBucket}`, PHONE_HOURLY_MAX, 3600),
    incrementAndCheck(`otp:ratelimit:phone:day:${id}:${dayBucket}`, PHONE_DAILY_MAX, 86400),
    incrementAndCheck(`otp:ratelimit:ip:hour:${ip}:${hourBucket}`, IP_HOURLY_MAX, 3600),
  ]);

  if (phoneHourOver || phoneDayOver) {
    throw new TooManyRequestsError('Too many OTP requests for this phone', {
      code: 'otp_rate_limited_phone',
    });
  }
  if (ipHourOver) {
    throw new TooManyRequestsError('Too many OTP requests from this network', {
      code: 'otp_rate_limited_ip',
    });
  }
}

/** Caps OTP verification attempts per network. claimAttempt caps guesses per
 *  challenge; without this an attacker just requests a new challenge each time
 *  to get a fresh budget. Fails closed like the send limiter. */
export async function checkOtpVerifyRateLimit(ip: string): Promise<void> {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const over = await incrementAndCheck(
    `otp:ratelimit:verify:ip:hour:${ip}:${hourBucket}`,
    VERIFY_IP_HOURLY_MAX,
    3600,
  );
  if (over) {
    throw new TooManyRequestsError('Too many OTP verification attempts from this network', {
      code: 'otp_verify_rate_limited_ip',
    });
  }
}

// Unverified-send breaker: pumping bots send a few OTPs per number (under every cap above)
// and verify none. Keyed on the number, so IP, TLS or URL-encoding rotation cannot dodge it.
// Thresholds come from env so they can be tuned without a deploy of new code.
const unverifiedSendMax = () => env.OTP_UNVERIFIED_SEND_MAX ?? 3;
const unverifiedTtlSeconds = () => env.OTP_UNVERIFIED_TTL_SECONDS ?? 24 * 60 * 60;

const unverifiedKey = (username: string) => `otp:unverified:${identityKey(username)}`;

export type UnverifiedBreakerMode = 'off' | 'log' | 'enforce';

/** Refuses a send once a number has OTP_UNVERIFIED_SEND_MAX sends with no verify behind it.
 *  In `log` mode it only records that it would have (shadow rollout). */
export async function checkOtpUnverifiedBreaker(
  username: string,
  mode: UnverifiedBreakerMode = env.OTP_UNVERIFIED_BREAKER_MODE ?? 'log',
): Promise<void> {
  if (mode === 'off') return;
  const sends = Number((await redis().get(unverifiedKey(username))) ?? 0);
  if (sends < unverifiedSendMax()) return;
  if (mode === 'log') {
    recordOtpMetric('otp_unverified_would_lock', { identifier: username, sends });
    return;
  }
  recordOtpMetric('otp_unverified_locked', { identifier: username, sends });
  throw new TooManyRequestsError('Too many OTPs sent to this number without verification', {
    code: 'otp_unverified_locked',
  });
}

/** Counts one more unverified send. The window starts at the first send, not the last. */
export async function noteOtpSentUnverified(username: string): Promise<void> {
  const key = unverifiedKey(username);
  await redis().incr(key);
  await redis().expire(key, unverifiedTtlSeconds(), 'NX');
}

/** A successful verify proves a person is on the other end, so start them clean. */
export async function clearOtpUnverified(username: string): Promise<void> {
  await redis().del(unverifiedKey(username));
}
