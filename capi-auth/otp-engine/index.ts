// The OTP engine — ported from the original prototype,
// with its one real bug fixed: attempts are tracked server-side (OtpAttempt,
// Unit 1) instead of trusting a client-held cookie, and challenge state lives
// in Postgres (OtpChallenge, Unit 5) instead of vanishing on restart.
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { claimAttempt, resetAttempts } from '../../repositories/otp_attempts';
import {
  createChallenge,
  getChallenge,
  markConsumed,
  resetChallenge,
  touchChallenge,
} from '../../repositories/otp_challenges';
import { sendOtpEmail } from './email';
import { identifierField, recordOtpMetric } from './metrics';
import { checkOtpSendRateLimit } from './rate_limit';
import { sendOtpSms } from './sms';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;

export type OtpChannel = 'mobile' | 'email';

// Rotating this invalidates every unexpired in-flight challenge (its codeHash
// was computed with the old secret) — acceptable for a secret that shouldn't
// rotate casually, but worth knowing before doing it on a whim.
function hashSecret(): string {
  if (!env.OTP_HASH_SECRET) {
    throw new Error('OTP_HASH_SECRET is not set — refusing to hash OTP codes with no secret');
  }
  return env.OTP_HASH_SECRET;
}

function hash(code: string): string {
  return createHmac('sha256', hashSecret()).update(code).digest('hex');
}

// Constant-time — a naive `hash(code) === codeHash` string comparison leaks
// timing information about how many leading characters matched. Both sides are
// already fixed-length hex digests.
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function createOtp(
  username: string,
  channel: OtpChannel,
): Promise<{ otpId: string; code: string }> {
  const code = genCode();
  const otpId = `otp_${randomUUID()}`;
  // Deliver BEFORE persisting, matching the vendor provider's ordering: a send
  // that throws must leave no challenge row behind — the row otherwise sits
  // unclaimed until its resendOtp-driven overwrite or the eventual signup
  // deleteChallenge, describing a code the customer never received.
  if (channel === 'mobile') await sendOtpSms(username, code);
  if (channel === 'email') await sendOtpEmail(username, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await createChallenge({ otpId, username, channel, codeHash: hash(code), expiresAt });
  await resetAttempts(otpId, expiresAt);
  recordOtpMetric('otp_sent', { channel, ...identifierField(channel, username) });
  return { otpId, code };
}

export type ResendResult =
  | { otpId: string; code: string }
  | { error: 'otp_not_found' | 'otp_cooldown' };

// The cooldown alone doesn't cap total sends — a caller can resend every 30s
// forever, resetting expiresAt each time. Resend must go through the same
// send caps as the initial send, or a phone/IP could bypass the send caps entirely
// by only ever hitting /resend after one throwaway /send.
//
// This check lives here, not in the resend handler (unlike send's, which
// checks in its handler): the send handler already has the phone from the
// request body, but the resend handler only has an otpId — only this
// function, after loading the challenge, knows which phone to check against.
export async function resendOtp(otpId: string, ip: string): Promise<ResendResult> {
  const existing = await getChallenge(otpId);
  if (!existing) return { error: 'otp_not_found' };
  if (Date.now() - existing.updatedAt.getTime() < RESEND_COOLDOWN_MS) {
    return { error: 'otp_cooldown' };
  }
  await checkOtpSendRateLimit(existing.username, ip);
  // Arms the cooldown before the send, not after — otherwise a throwing send
  // never bumps updatedAt, and an immediate retry passes the cooldown check
  // that just let this attempt through, with only the per-phone/IP cap slowing it.
  await touchChallenge(otpId);
  const code = genCode();
  // Send first, then overwrite. The other order was a hard lockout: resetChallenge
  // kills the code the customer can still see in their inbox, so a send that then
  // throws leaves them with one dead code and one never delivered.
  if (existing.channel === 'mobile') await sendOtpSms(existing.username, code);
  if (existing.channel === 'email') await sendOtpEmail(existing.username, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await resetChallenge(otpId, hash(code), expiresAt);
  await resetAttempts(otpId, expiresAt);
  recordOtpMetric('otp_resent', {
    channel: existing.channel,
    ...identifierField(existing.channel, existing.username),
  });
  return { otpId, code };
}

export type VerifyResult =
  | { ok: true; username: string; channel: OtpChannel }
  | { ok: false; error: 'otp_not_found' | 'otp_expired' | 'otp_incorrect' | 'otp_locked' };

export async function verifyOtp(otpId: string, code: string): Promise<VerifyResult> {
  const challenge = await getChallenge(otpId);
  if (!challenge || challenge.consumed) return { ok: false, error: 'otp_not_found' };
  if (Date.now() > challenge.expiresAt.getTime()) {
    recordOtpMetric('otp_verify_expired', {
      channel: challenge.channel,
      ...identifierField(challenge.channel, challenge.username),
    });
    return { ok: false, error: 'otp_expired' };
  }

  // Spend an attempt BEFORE comparing. Checking a count and then incrementing
  // let concurrent verifies all pass the gate on the same budget.
  const claim = await claimAttempt(otpId, MAX_ATTEMPTS);
  if (!claim.ok) {
    if (claim.reason === 'unknown') return { ok: false, error: 'otp_not_found' };
    recordOtpMetric('otp_verify_locked', {
      channel: challenge.channel,
      ...identifierField(challenge.channel, challenge.username),
    });
    return { ok: false, error: 'otp_locked' };
  }

  if (!hashesMatch(hash(code), challenge.codeHash)) {
    const locked = claim.attempts >= MAX_ATTEMPTS;
    recordOtpMetric(locked ? 'otp_verify_locked' : 'otp_verify_failed', {
      channel: challenge.channel,
      ...identifierField(challenge.channel, challenge.username),
    });
    return { ok: false, error: locked ? 'otp_locked' : 'otp_incorrect' };
  }

  // Consume atomically: two concurrent verifies of the SAME correct code both
  // passed `challenge.consumed` above, and would each mint a session.
  if (!(await markConsumed(otpId))) return { ok: false, error: 'otp_not_found' };
  // createdAt is the ORIGINAL send time — resendOtp doesn't touch it, so a
  // resend-before-verify inflates this beyond the actual time since the code
  // the customer typed was sent.
  recordOtpMetric('otp_verify_success', {
    channel: challenge.channel,
    durationMs: Date.now() - challenge.createdAt.getTime(),
    ...identifierField(challenge.channel, challenge.username),
  });
  return { ok: true, username: challenge.username, channel: challenge.channel as OtpChannel };
}
