#!/usr/bin/env bun

/**
 * Recover the plaintext 6-digit OTP for a live challenge, for support use.
 * ----------------------------------------------------------------------------
 * WHAT
 * The code is never stored — only HMAC-SHA256(OTP_HASH_SECRET, code). This
 * brute-forces the 1,000,000-value space (000000-999999) against the stored
 * hash and prints the match. Same cost as one login attempt: a few hundred
 * milliseconds, not a real brute force in the security sense.
 *
 * WHY THIS IS SAFE TO SHIP AS A SCRIPT
 * Running it already requires OTP_HASH_SECRET (an app secret) and read access
 * to the challenge store (Redis) — both of which mean full backend access to
 * this system already. The script grants no privilege beyond what operating
 * the codebase requires; it does not let anyone bypass OTP who couldn't
 * already forge a session by other means with the same access.
 *
 * WHAT IT DOES NOT DO
 * It does not consume, expire, or otherwise touch the challenge — read-only.
 * It cannot recover a code for someone else's account without their otpId,
 * which is only known to the customer's own client and to this backend.
 *
 * USE
 *   bun run capi-auth/otp-engine/scripts/decode-otp.ts <otpId>
 *   bun run capi-auth/otp-engine/scripts/decode-otp.ts --hash <codeHash>
 *
 * The first form reads the live challenge from Redis (via getChallenge) and
 * decodes its current codeHash. The second decodes an already-known hash
 * directly — useful once the challenge itself has expired or been consumed,
 * if the hash was captured beforehand.
 *
 * Requires OTP_HASH_SECRET in the environment, same as the app itself.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getChallenge } from '../repositories/otp_challenges';

function hash(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function decode(codeHash: string, secret: string): string | null {
  for (let n = 0; n < 1_000_000; n++) {
    const candidate = String(n).padStart(6, '0');
    if (hashesMatch(hash(candidate, secret), codeHash)) return candidate;
  }
  return null;
}

async function main() {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret) {
    console.error('OTP_HASH_SECRET is not set.');
    process.exit(1);
  }

  const [flagOrOtpId, maybeHash] = process.argv.slice(2);
  let codeHash: string;
  let context = '';

  if (flagOrOtpId === '--hash') {
    if (!maybeHash) {
      console.error('Usage: decode-otp.ts --hash <codeHash>');
      process.exit(1);
    }
    codeHash = maybeHash;
  } else {
    const otpId = flagOrOtpId;
    if (!otpId) {
      console.error('Usage: decode-otp.ts <otpId>  |  decode-otp.ts --hash <codeHash>');
      process.exit(1);
    }
    const challenge = await getChallenge(otpId);
    if (!challenge) {
      console.error(`No live challenge for otpId ${otpId} — it may have expired or been consumed.`);
      process.exit(1);
    }
    codeHash = challenge.codeHash;
    context = ` (channel=${challenge.channel}, username=${challenge.username}, consumed=${challenge.consumed})`;
  }

  const started = Date.now();
  const code = decode(codeHash, secret);
  const ms = Date.now() - started;

  if (!code) {
    console.error(`No 6-digit code hashes to ${codeHash}. Wrong secret, or the hash isn't ours.`);
    process.exit(1);
  }
  console.log(`code: ${code}${context}  (${ms}ms)`);
}

main();
