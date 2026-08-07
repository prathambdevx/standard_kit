// Resolves the authenticated customer's identity from a Shopify Customer
// Account API (CAPI) access token — the CAPI-side counterpart of
// services/shopify/storefront/customer.ts's getCustomerByAccessToken, used by
// middleware/customer.ts to satisfy requireCustomer for a CAPI session
// Field names confirmed against Shopify's
// Customer Account API schema reference (shopify.dev/docs/api/customer/latest/
// objects/Customer, 2026-08-06): `id: ID!`, `displayName: String!`,
// `emailAddress: CustomerEmailAddress` (nullable, nested `emailAddress: String`).
import { shopifyCustomerAccountGraphQL } from '@devxcommerce/bff-core';

const CUSTOMER_IDENTITY_QUERY = `
  query CapiCustomerIdentity {
    customer {
      id
      displayName
      emailAddress {
        emailAddress
      }
    }
  }
`;

interface CapiCustomerIdentityResponse {
  customer: {
    id: string;
    displayName: string;
    emailAddress: { emailAddress: string } | null;
  } | null;
}

export type CapiCustomer = {
  shopifyId: string;
  name: string;
  email: string;
  hasRealEmail: boolean; // false when `email` below is the synthesized placeholder, not an address Shopify holds
};

/** Resolves a CAPI access token to the authenticated customer's identity; null when Shopify returns no customer. */
export async function getCapiCustomer(accessToken: string): Promise<CapiCustomer | null> {
  const { customer } = await shopifyCustomerAccountGraphQL<CapiCustomerIdentityResponse>(
    accessToken,
    CUSTOMER_IDENTITY_QUERY,
  );
  if (!customer) return null;
  const real = customer.emailAddress?.emailAddress;
  return {
    shopifyId: customer.id,
    name: customer.displayName,
    // CAPI customers without an email are rare (1,080 / 0.18% per records.md) —
    // synthesize a stable unique address, matching getCustomerByAccessToken's
    // fallback for the same case. It exists to key our own brand-DB row, and
    // must never be written back to Shopify: `hasRealEmail` is what callers
    // check before putting this on a cart, order, or anything a customer sees.
    email: real ?? `${customer.id.split('/').pop()}@noemail.bsc`,
    hasRealEmail: !!real,
  };
}
