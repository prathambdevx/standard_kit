import { log, ServiceUnavailableError } from '@devxcommerce/bff-core';
import { env } from '../../config/env';

// A working SES send already exists (services/email) — what's missing is the
// subject/body copy, so this stays mocked. Like sms.ts it refuses on the prod
// stage rather than resolving successfully: a silent "sent" makes every email
// login return 200 and deliver nothing, with otp_sent reporting success anyway.
//
// APP_STAGE, not NODE_ENV — the latter is `production` on dev and uat too, so
// that check would break OTP sends in every deployed environment.
// `stage` is injected (defaulting to env) purely so the prod refusal is testable —
// see sms.ts for why a parameter rather than a module mock.
export async function sendOtpEmail(
  email: string,
  code: string,
  stage: string = env.APP_STAGE,
): Promise<void> {
  if (stage === 'prod') {
    throw new ServiceUnavailableError(
      'No OTP email template is wired — refusing to report a delivered OTP that was never sent. ' +
        'Call services/email sendEmail() here, or keep OTP_VENDOR_ENABLED=true.',
      { code: 'otp_gateway_unconfigured' },
    );
  }
  // Never log the code itself, mock or not — it's a live credential either way.
  void code;
  log.info({ email }, '[otp mock] would send email — no OTP template wired yet');
}
