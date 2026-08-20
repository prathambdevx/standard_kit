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
| ✅ | Rate-limiter failure stops sending rather than going unlimited (proven: verified against a real broken Redis call, not just read) | `rate_limit.ts` |
| ✅ | Expired codes give a clear "expired" response, never confused with "not found" | `repositories/otp_challenges.ts` |
| ✅ | Sending an OTP request looks the same whether the account exists or not (no enumeration) | `routes/otp_handlers.ts` |
| ✅ | The real OTP code is never written to any log | `sms.ts`, `email.ts` |
| ✅ | Every record self-expires in Redis — no cleanup job to forget | `repositories/otp_challenges.ts`, `otp_attempts.ts` |

## Real measured latency

- `verify` p99 = 0.53ms (in-process, 300 cycles, engine only).
- `send` p95 = 4.10ms (real HTTP round trip, 100 cycles, includes routing/validation/network).
  (A real HTTP `verify` number would be dominated by whatever customer-lookup call runs *after*
  code verification succeeds — a separate downstream dependency, not the engine itself.)

**Not covered here:** actual SMS/email delivery — retries, carrier failover, deliverability.
That's whatever vendor you plug into `provider.ts`. This folder is only responsible for
generating, storing, and checking the code correctly.
