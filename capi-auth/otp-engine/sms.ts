import { log, ServiceUnavailableError } from '@devxcommerce/bff-core';
import { env } from '../../config/env';

// No SMS gateway is wired yet (Gupshup/MSG91 is its own unit). Until one is,
// this refuses on the prod stage rather than resolving successfully: a mock that
// silently "succeeds" makes every login return 200 with an otpId, record
// otp_sent, and deliver nothing — response and metrics both look healthy while
// no customer can log in.
//
// Gated on APP_STAGE, not NODE_ENV: NODE_ENV is `production` on dev and uat too
// (config/env.ts's APP_STAGE comment, db/client.ts's SSL note), so a NODE_ENV
// check would hard-fail OTP sends in every deployed environment. Local, CI, dev
// and uat keep the log-only path so they run gateway-less.
// `stage` is injected (defaulting to env) purely so the prod refusal is testable:
// @t3-oss/env-core freezes env at import, and Bun's module mock leaks across a
// directory-wide run — so a parameter is the only seam that doesn't distort the suite.
export async function sendOtpSms(
  phoneE164: string,
  code: string,
  stage: string = env.APP_STAGE,
): Promise<void> {
  if (stage === 'prod') {
    throw new ServiceUnavailableError(
      'No SMS gateway is wired — refusing to report a delivered OTP that was never sent. ' +
        'Wire a real gateway here, or point provider.ts at a vendor-backed implementation instead.',
      { code: 'otp_gateway_unconfigured' },
    );
  }
  // Never log the code itself, mock or not — it's a live credential either way.
  void code;
  log.info({ phoneE164 }, '[otp mock] would send SMS — no real gateway wired yet');
}
