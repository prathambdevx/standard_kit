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
