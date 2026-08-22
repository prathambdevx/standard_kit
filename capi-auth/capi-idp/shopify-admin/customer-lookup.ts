// Phone-first customer resolution against Shopify Admin — the lookup a
// verified OTP hands off to. Measured live at roughly 3 GraphQL rate-limit
// points per call, comfortably inside Shopify Plus's bucket for typical traffic.
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

type CustomersQueryData = {
  customers: {
    nodes: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
    }>;
  };
};

const FIND_BY_PHONE_QUERY = `
  query FindCustomerByPhone($q: String!) {
    customers(first: 1, query: $q) {
      nodes { id firstName lastName email phone }
    }
  }
`;

const FIND_BY_EMAIL_QUERY = `
  query FindCustomerByEmail($q: String!) {
    customers(first: 1, query: $q) {
      nodes { id firstName lastName email phone }
    }
  }
`;

function toAdminCustomer(node: CustomersQueryData['customers']['nodes'][number]): AdminCustomer {
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
 *  address, which the phone query can never match. */
export async function findCustomerByEmail(email: string): Promise<AdminCustomer | null> {
  // Quoted for the same reason as the phone query: an address contains "@" and
  // "." which Shopify's search syntax would otherwise tokenize.
  const data = await shopifyAdminGraphQL<CustomersQueryData>(FIND_BY_EMAIL_QUERY, {
    q: `email:"${email}"`,
  });
  const node = data.customers.nodes[0];
  return node ? toAdminCustomer(node) : null;
}

export async function findCustomerByPhone(phoneE164: string): Promise<AdminCustomer | null> {
  // Quoted — phoneE164 always starts with "+", which Shopify's search syntax
  // otherwise reads as a query connective, not part of the literal value.
  const data = await shopifyAdminGraphQL<CustomersQueryData>(FIND_BY_PHONE_QUERY, {
    q: `phone:"${phoneE164}"`,
  });
  const node = data.customers.nodes[0];
  return node ? toAdminCustomer(node) : null;
}
