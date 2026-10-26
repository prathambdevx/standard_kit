# OTP engine

Our own in-house OTP generation and verification code. If you plug in a real delivery vendor
instead (see `provider.ts`), the vendor generates and verifies the code itself; this folder then
only handles storage/attempt-limiting around it.

## Checked against industry standards — NIST SP 800-63B + OWASP

| ✅ | Check | Where |
|---|---|---|
| ✅ | Code generated with a secure random number generator, never a weak/predictable one | `index.ts` |
| ✅ | Code never stored as plain text — only a keyed hash | `index.ts` |
| ✅ | Comparison is constant-time — can't be timed to guess characters | `index.ts` |
| ✅ | A code can only be used once, even under concurrent attempts | `repositories/otp_challenges.ts` |
| ✅ | 5-attempt cap, atomic — can't be bypassed by guessing in parallel (proven: 40 simultaneous guesses → exactly 5 allowed) | `repositories/otp_attempts.ts` |
| ✅ | Send limits per phone number and per IP | `rate_limit.ts` |
| ✅ | Rate-limit IP can't be spoofed (proven: a forged leading `X-Forwarded-For` entry doesn't reset the cap) | `rate_limit.ts` |
| ✅ | A number with several sends and no verify is refused (unverified-send breaker, shadow mode first) | `rate_limit.ts` |
| ✅ | Rate-limiter failure stops sending rather than going unlimited (proven: verified against a real broken Redis call, not just read) | `rate_limit.ts` |
| ✅ | Expired codes give a clear "expired" response, never confused with "not found" | `repositories/otp_challenges.ts` |
| ✅ | Sending an OTP request looks the same whether the account exists or not (no enumeration) | `routes/otp_handlers.ts` |
| ✅ | The real OTP code is never written to any log | `sms.ts`, `email.ts` |
| ✅ | Every record self-expires in Redis — no cleanup job to forget | `repositories/otp_challenges.ts`, `otp_attempts.ts` |

## Unverified-send breaker (SMS-pumping defence)

Per-number hourly and daily caps do not stop a bot that sends a few OTPs to each of thousands of
numbers and verifies none. The breaker counts sends per number that had no successful verify
behind them, and refuses the next send past a threshold.

- `checkOtpUnverifiedBreaker()` runs before the send, `noteOtpSentUnverified()` after it, and
  `clearOtpUnverified()` on a successful verify. Resend goes through the same path.
- Keyed on the number, so rotating IP, TLS fingerprint or URL encoding cannot dodge it.
- The window starts at the first unverified send (`EXPIRE ... NX`), not the last, so steady
  retries cannot keep it open forever.
- Env: `OTP_UNVERIFIED_BREAKER_MODE` = `off` | `log` | `enforce` (default `log`),
  `OTP_UNVERIFIED_SEND_MAX` (default 3), `OTP_UNVERIFIED_TTL_SECONDS` (default 86400).
- `log` mode records `otp_unverified_would_lock` and refuses nothing. Ship in `log`, read a week
  of those lines, and move to `enforce` only when it touches pumping numbers and not real users.
  `enforce` throws a 429 with code `otp_unverified_locked` and records `otp_unverified_locked`.
- Every `otp_*` metric line carries the recipient, `otpId` on send/resend, and the caller (see
  `metrics.ts`), so a would-lock line can be traced to who asked.
- If you add a fixed test identity that skips the real send, keep it out of the breaker: it never
  costs an SMS, so counting it would only ever lock your QA number.
- Your frontend needs copy for `otp_unverified_locked` (for example: several OTPs were sent to
  this number but none was entered, try again after 24 hours).

This is a second layer. The first layer is the edge (see "Edge protection for OTP endpoints" in
`../README.md`).

## Real measured latency

- `verify` p99 = 0.53ms (in-process, 300 cycles, engine only).
- `send` p95 = 4.10ms (real HTTP round trip, 100 cycles, includes routing/validation/network).
  (A real HTTP `verify` number would be dominated by whatever customer-lookup call runs *after*
  code verification succeeds — a separate downstream dependency, not the engine itself.)

**Not covered here:** actual SMS/email delivery — retries, carrier failover, deliverability.
That's whatever vendor you plug into `provider.ts`. This folder is only responsible for
generating, storing, and checking the code correctly.

## Support tooling

`scripts/decode-otp.ts` recovers the plaintext code for a live (or previously captured)
challenge — brute-forcing all 1,000,000 six-digit values against the stored hash, which
costs the same few hundred milliseconds as one real login attempt, not a real brute force.
Needs `OTP_HASH_SECRET` and either an `otpId` (reads the live challenge from Redis) or an
already-known `codeHash`. Read-only — never consumes or expires the challenge.

This doesn't weaken the "code never logged" property above: running it already requires
the app secret plus backend access to the challenge store, which is the same access level
needed to forge a session by other means. It grants no new privilege — it just saves
re-deriving the hash math by hand for a support ticket.
