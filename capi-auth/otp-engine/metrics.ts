// Observability stub — structured log events for the dashboards this is meant
// to feed later (OTPs sent, verify success rate, time-to-verify). No metrics
// infra exists yet; this just makes sure the data is already flowing by the
// time a dashboard is built, instead of starting from zero.
import { log } from '@devxcommerce/bff-core';

export type OtpMetricEvent =
  | 'otp_sent'
  | 'otp_resent'
  | 'otp_verify_success'
  | 'otp_verify_failed'
  | 'otp_verify_locked'
  | 'otp_verify_expired';

export function recordOtpMetric(event: OtpMetricEvent, fields: Record<string, unknown> = {}): void {
  log.info({ metric: event, ...fields }, `[otp metric] ${event}`);
}

// Both channels carry the recipient, so a login can be traced by the identifier
// the customer actually used. SMS was omitted originally on the reasoning that
// the vendor's own logs cover it — but those are typically IP-allowlisted to the
// server, so an engineer debugging from a laptop gets a 401 and a phone login has
// nothing to search by at all.
//
// The tradeoff is real: this puts a phone number in application logs and in any
// alert channel they fan out to. Drop the mobile branch if your vendor's logs are
// genuinely reachable during an incident, or if PII in logs is not acceptable to you.
export function identifierField(_channel: string, username: string): Record<string, unknown> {
  return { identifier: username };
}
