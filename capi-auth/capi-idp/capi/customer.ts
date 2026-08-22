// Resolves the authenticated customer's identity from a Shopify Customer
// Account API (CAPI) access token — the CAPI-side counterpart of
// services/shopify/storefront/customer.ts's getCustomerByAccessToken, used by
// middleware/customer.ts to satisfy requireCustomer for a CAPI session.
// Field names confirmed against Shopify's Customer Account API schema reference
// (shopify.dev/docs/api/customer/latest/objects/Customer, 2026-08-06):
// `id: ID!`, `displayName: String!`, `emailAddress: CustomerEmailAddress`
// (nullable, nested `emailAddress: String`).
import { log, shopifyCustomerAccountGraphQL } from '@devxcommerce/bff-core';
import { isWellFormedEmail } from '../email-domain';

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
  email: string; // always a real, usable address — see getCapiCustomer
};

/**
 * Resolves a CAPI access token to the authenticated customer's identity.
 *
 * Null when Shopify returns no customer, AND when the customer has no usable
 * email. The signup gate (repositories/customers.ts's IdentityLookup) means no
 * session should ever be issued to such a customer, so reaching here is an
 * invalid state — a record mutated outside this flow (Shopify admin, POS, an
 * import) or a session predating the rule. Answering null rather than throwing
 * makes the caller 401, which sends them back through the gate that fills the
 * missing address in: self-healing instead of a hard 502. Logged, because a
 * silent one would hide a real data problem.
 */
export async function getCapiCustomer(accessToken: string): Promise<CapiCustomer | null> {
  const { customer } = await shopifyCustomerAccountGraphQL<CapiCustomerIdentityResponse>(
    accessToken,
    CUSTOMER_IDENTITY_QUERY,
  );
  if (!customer) return null;
  const email = customer.emailAddress?.emailAddress;
  if (!isWellFormedEmail(email)) {
    log.warn(
      { shopifyId: customer.id, hasEmail: !!email },
      'CAPI customer has no usable email — refusing the session so re-login routes them through the signup gate',
    );
    return null;
  }
  return {
    shopifyId: customer.id,
    name: customer.displayName,
    email: email as string,
  };
}
