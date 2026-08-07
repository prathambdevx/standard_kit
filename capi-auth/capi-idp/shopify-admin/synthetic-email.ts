// One canonical scheme for the synthetic email minted for phone-only signups
// (Shopify requires every customer to have one). The prototype this replaces
// had three conflicting call sites — phone-derived in one place, customer-ID-
// derived in another, and a third independent hardcoded domain string used
// only to detect one — so any two of them could disagree on the same customer.
import { shopifyAdminGraphQL, UpstreamError } from '@devxcommerce/bff-core';
import { env } from '../../../config/env';

function domain(): string {
  if (!env.SYNTHETIC_EMAIL_DOMAIN) {
    throw new Error(
      'SYNTHETIC_EMAIL_DOMAIN is not set — this must be a real decision ' +
        '(a domain you actually own and control DNS for), not something to default silently',
    );
  }
  return env.SYNTHETIC_EMAIL_DOMAIN;
}

export function syntheticEmailForPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `${digits}@${domain()}`;
}

/** Detector, not a minter — answers false when no domain is configured instead of throwing.
 *  `domain()` throwing here took down the whole email-OTP send path: sendOtpHandler calls
 *  this on every email login, so an unset SYNTHETIC_EMAIL_DOMAIN 500'd the request
 *  before an OTP was ever attempted. With no configured domain nothing can have minted a
 *  synthetic address, so "not synthetic" is the correct answer, not an error. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  const configured = env.SYNTHETIC_EMAIL_DOMAIN;
  if (!configured || !email) return false;
  return email.toLowerCase().endsWith(`@${configured.toLowerCase()}`);
}

type Deps = { adminUpdate?: (customerId: string, email: string) => Promise<void> };

/** Backfills the canonical synthetic email onto a Shopify customer with none on file (the null-email segment, records.md); no-op if any email already exists. */
export async function ensureSyntheticEmail(
  customer: { id: string; email: string | null },
  phoneE164: string,
  deps: Deps = {},
): Promise<string> {
  if (customer.email) return customer.email;
  const email = syntheticEmailForPhone(phoneE164);
  const adminUpdate = deps.adminUpdate ?? defaultAdminUpdate;
  await adminUpdate(customer.id, email);
  return email;
}

type CustomerUpdateData = {
  customerUpdate: { userErrors: Array<{ message: string }> };
};

/** Writes an email onto a Shopify customer. Throws UpstreamError with the userErrors
 *  joined — a duplicate address is reported that way, not as a 4xx, so callers that
 *  can't resolve a merge must catch rather than assume success. */
export async function setShopifyCustomerEmail(customerId: string, email: string): Promise<void> {
  return defaultAdminUpdate(customerId, email);
}

async function defaultAdminUpdate(customerId: string, email: string): Promise<void> {
  const data = await shopifyAdminGraphQL<CustomerUpdateData>(
    `mutation SetSyntheticEmail($input: CustomerInput!) {
      customerUpdate(input: $input) { userErrors { message } }
    }`,
    { input: { id: customerId, email } },
  );
  const errors = data.customerUpdate.userErrors;
  if (errors.length > 0) {
    throw new UpstreamError(errors.map((e) => e.message).join('; '), {
      code: 'customer_email_backfill_failed',
    });
  }
}
