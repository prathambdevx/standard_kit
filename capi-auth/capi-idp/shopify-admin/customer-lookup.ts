// Phone-first customer resolution against Shopify Admin — the lookup a
// verified OTP hands off to. Measured live at roughly 3 GraphQL rate-limit
// points per call, comfortably inside Shopify Plus's bucket for typical traffic.
import { shopifyAdminGraphQL } from '@devxcommerce/bff-core';

export type AdminCustomer = { id: string; email: string | null; name: string };

type CustomersQueryData = {
  customers: {
    nodes: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    }>;
  };
};

const FIND_BY_PHONE_QUERY = `
  query FindCustomerByPhone($q: String!) {
    customers(first: 1, query: $q) {
      nodes { id firstName lastName email }
    }
  }
`;

const FIND_BY_EMAIL_QUERY = `
  query FindCustomerByEmail($q: String!) {
    customers(first: 1, query: $q) {
      nodes { id firstName lastName email }
    }
  }
`;

/** Email counterpart of findCustomerByPhone — the email OTP channel verifies an
 *  address, which the phone query can never match. */
export async function findCustomerByEmail(email: string): Promise<AdminCustomer | null> {
  // Quoted for the same reason as the phone query: an address contains "@" and
  // "." which Shopify's search syntax would otherwise tokenize.
  const data = await shopifyAdminGraphQL<CustomersQueryData>(FIND_BY_EMAIL_QUERY, {
    q: `email:"${email}"`,
  });
  const node = data.customers.nodes[0];
  if (!node) return null;
  return {
    id: node.id,
    email: node.email,
    name: [node.firstName, node.lastName].filter(Boolean).join(' ') || 'Customer',
  };
}

export async function findCustomerByPhone(phoneE164: string): Promise<AdminCustomer | null> {
  // Quoted — phoneE164 always starts with "+", which Shopify's search syntax
  // otherwise reads as a query connective, not part of the literal value.
  const data = await shopifyAdminGraphQL<CustomersQueryData>(FIND_BY_PHONE_QUERY, {
    q: `phone:"${phoneE164}"`,
  });
  const node = data.customers.nodes[0];
  if (!node) return null;
  return {
    id: node.id,
    email: node.email,
    name: [node.firstName, node.lastName].filter(Boolean).join(' ') || 'Customer',
  };
}
