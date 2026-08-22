// Fills in a missing identifier on an EXISTING Shopify customer — the other half
// of customer-create.ts. Used when a verified login resolves to a real customer
// whose profile is incomplete (no email, or no phone): customerUpdate keeps their
// id, so orders/addresses/everything stay attached. Calling customerCreate for
// this case instead would either collide on the identifier they already have or
// mint a duplicate showing none of their history.
import {
  assertNoShopifyUserErrors,
  ConflictError,
  shopifyAdminGraphQL,
  UpstreamError,
} from '@devxcommerce/bff-core';

export type ShopifyCustomerPatch = {
  id: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
};

type CustomerUpdateData = {
  customerUpdate: {
    customer: { id: string; email: string | null; phone: string | null } | null;
    // Same plain `UserError` shape as customerCreate — field/message only, no
    // `code`. Querying `code` makes Shopify reject the whole mutation.
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

export const UPDATE_CUSTOMER_MUTATION = `
  mutation UpdateCustomer($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer { id email phone }
      userErrors { field message }
    }
  }
`;

type Deps = {
  adminUpdate?: (patch: ShopifyCustomerPatch) => Promise<{ id: string; email: string | null }>;
};

/** Patches an existing Shopify customer. Throws ConflictError (customer_email_taken /
 *  customer_phone_taken) when the identifier belongs to someone else — the caller
 *  must surface that so the customer can enter a different one. */
export async function updateShopifyCustomer(
  patch: ShopifyCustomerPatch,
  deps: Deps = {},
): Promise<{ id: string; email: string | null }> {
  const adminUpdate = deps.adminUpdate ?? defaultAdminUpdate;
  return adminUpdate(patch);
}

async function defaultAdminUpdate(
  patch: ShopifyCustomerPatch,
): Promise<{ id: string; email: string | null }> {
  const data = await shopifyAdminGraphQL<CustomerUpdateData>(UPDATE_CUSTOMER_MUTATION, {
    input: patch,
  });
  const errors = data.customerUpdate.userErrors;
  if (errors.length > 0) {
    // Same message-text detection as customer-create.ts: `field` alone can't tell
    // a duplicate from a plain validation failure on the same field.
    if (errors.length === 1 && /already been taken/i.test(errors[0]?.message ?? '')) {
      const field = errors[0]?.field;
      if (field?.includes('email')) {
        throw new ConflictError('That email is already used by another account', {
          code: 'customer_email_taken',
        });
      }
      if (field?.includes('phone')) {
        throw new ConflictError('That phone number is already used by another account', {
          code: 'customer_phone_taken',
        });
      }
    }
    assertNoShopifyUserErrors('customerUpdate', errors);
  }
  const customer = data.customerUpdate.customer;
  if (!customer) {
    throw new UpstreamError('customerUpdate returned no customer and no userErrors', {
      code: 'customer_update_failed',
    });
  }
  return { id: customer.id, email: customer.email };
}
