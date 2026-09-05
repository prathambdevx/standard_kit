// Phone-first customer resolution against Shopify Admin — the lookup a
// verified OTP hands off to. Measured live at 1 GraphQL rate-limit point per
// call, comfortably inside Shopify Plus's bucket for typical traffic.
import { shopifyAdminGraphQL } from '@devxcommerce/bff-core';

// phone/firstName/lastName are carried so the caller can tell a COMPLETE profile
// from one missing an identifier, and prefill the details form from what Shopify
// already holds instead of asking again. See repositories/customers.ts.
export type AdminCustomer = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
};

// customerByIdentifier resolves an identifier to the customer it BELONGS to.
// A `customers(query:)` search matches the identifier anywhere on the record — a
// saved ADDRESS phone included — so it can return a stranger who merely shipped
// to that number, and a verified OTP then opens a session on THEIR account.
// That is not hypothetical: it happened in production (BSC, 2026-09-05).
type CustomerByIdentifierData = {
  customerByIdentifier: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

const FIND_BY_PHONE_QUERY = `
  query FindCustomerByPhone($phone: String!) {
    customerByIdentifier(identifier: { phoneNumber: $phone }) {
      id firstName lastName email phone
    }
  }
`;

const FIND_BY_EMAIL_QUERY = `
  query FindCustomerByEmail($email: String!) {
    customerByIdentifier(identifier: { emailAddress: $email }) {
      id firstName lastName email phone
    }
  }
`;

function toAdminCustomer(
  node: NonNullable<CustomerByIdentifierData['customerByIdentifier']>,
): AdminCustomer {
  return {
    id: node.id,
    email: node.email,
    phone: node.phone,
    firstName: node.firstName,
    lastName: node.lastName,
    name: [node.firstName, node.lastName].filter(Boolean).join(' ') || 'Customer',
  };
}

/** Email counterpart of findCustomerByPhone — the email OTP channel verifies an
 *  address, which the phone lookup can never match. Matched case-insensitively. */
export async function findCustomerByEmail(email: string): Promise<AdminCustomer | null> {
  const data = await shopifyAdminGraphQL<CustomerByIdentifierData>(FIND_BY_EMAIL_QUERY, { email });
  const node = data.customerByIdentifier;
  return node ? toAdminCustomer(node) : null;
}

export async function findCustomerByPhone(phoneE164: string): Promise<AdminCustomer | null> {
  const data = await shopifyAdminGraphQL<CustomerByIdentifierData>(FIND_BY_PHONE_QUERY, {
    phone: phoneE164,
  });
  const node = data.customerByIdentifier;
  return node ? toAdminCustomer(node) : null;
}
