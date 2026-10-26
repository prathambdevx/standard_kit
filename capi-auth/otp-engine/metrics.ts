// Observability stub — structured log events for the dashboards this is meant
// to feed later (OTPs sent, verify success rate, time-to-verify). No metrics
// infra exists yet; this just makes sure the data is already flowing by the
// time a dashboard is built, instead of starting from zero.
import { AsyncLocalStorage } from 'node:async_hooks';
import { log } from '@devxcommerce/bff-core';

export type OtpMetricEvent =
  | 'otp_sent'
  | 'otp_resent'
  | 'otp_verify_success'
  | 'otp_verify_failed'
  | 'otp_verify_locked'
  | 'otp_verify_expired'
  | 'otp_unverified_would_lock'
  | 'otp_unverified_locked';

// Per-request fields (request id, login trace id, caller) that handlers set once, so every
// metric line in the request carries them without threading them through the engine.
const requestFields = new AsyncLocalStorage<Record<string, unknown>>();

/** Adds fields to every metric recorded for the rest of this request. */
export function setOtpMetricContext(fields: Record<string, unknown>): void {
  requestFields.enterWith({ ...requestFields.getStore(), ...fields });
}

export function recordOtpMetric(event: OtpMetricEvent, fields: Record<string, unknown> = {}): void {
  // Spread after `fields` so a caller cannot overwrite the correlation values.
  log.info({ metric: event, ...fields, ...requestFields.getStore() }, `[otp metric] ${event}`);
}

// Both channels carry the recipient: a delivery-log view and an SMS-pumping
// investigation both need to see WHICH numbers were targeted. This puts phone
// numbers in logs, so keep that log group short-retention and access-controlled.
// Return {} for the mobile channel if your own policy forbids it.
export function identifierField(_channel: string, username: string): Record<string, unknown> {
  return { identifier: username };
}
