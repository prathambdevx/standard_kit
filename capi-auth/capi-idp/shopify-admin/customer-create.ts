// Creates a brand-new Shopify customer for a phone/email-verified signup with
// no existing Shopify record at all. This is the one canonical caller of the
// customerCreate mutation in this codebase.
import { ConflictError, shopifyAdminGraphQL, UpstreamError } from '@devxcommerce/bff-core';

export type NewShopifyCustomer = { id: string; email: string | null };

// acceptEmailMarketing/acceptSmsMarketing mirror your own signup form's
// consent checkboxes — map them onto Shopify's nested consent input shape below.
export type CustomerCreateInput = {
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  acceptEmailMarketing?: boolean;
  acceptSmsMarketing?: boolean;
};

// Shopify's actual CustomerInput shape for marketing consent — a nested
// object with a required marketingState, not a bare boolean. customerCreate
// additionally requires marketingOptInLevel whenever marketingState is
// SUBSCRIBED — without it the WHOLE mutation is rejected ("Marketing opt in
// level must exist"), so a signup 502s the moment a consent box is ticked.
// SINGLE_OPT_IN matches what a plain checkbox actually collects (no separate
// confirmation step); use CONFIRMED_OPT_IN only if you really send one.
type MarketingConsentInput = {
  marketingState: 'SUBSCRIBED' | 'NOT_SUBSCRIBED';
  marketingOptInLevel?: 'SINGLE_OPT_IN';
};

type ShopifyCustomerInput = {
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  emailMarketingConsent?: MarketingConsentInput;
  smsMarketingConsent?: MarketingConsentInput;
};

type CustomerCreateData = {
  customerCreate: {
    customer: { id: string; email: string | null } | null;
    // customerCreate's userErrors resolve to the plain `UserError` type, which
    // has only field/message — no `code`. Querying `code` here previously made
    // Shopify reject the WHOLE mutation at schema-validation time (undefinedField),
    // 502ing every phone-first signup before any data was ever touched.
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

export const CREATE_CUSTOMER_MUTATION = `
  mutation CreateCustomer($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id email }
      userErrors { field message }
    }
  }
`;

// Omitted (not set to false) when the caller never said either way — only an
// explicit true/false becomes an explicit Shopify subscription state.
function toMarketingConsent(accept: boolean | undefined): MarketingConsentInput | undefined {
  if (accept === undefined) return undefined;
  return accept
    ? { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' }
    : { marketingState: 'NOT_SUBSCRIBED' };
}

function toShopifyInput(input: CustomerCreateInput): ShopifyCustomerInput {
  const { acceptEmailMarketing, acceptSmsMarketing, ...rest } = input;
  return {
    ...rest,
    emailMarketingConsent: toMarketingConsent(acceptEmailMarketing),
    // Shopify rejects the WHOLE customerCreate if smsMarketingConsent is present
    // at all without a phone on the input — true or false, doesn't matter, its
    // mere presence is the trigger. Email-channel signup may or may not have a
    // typed phone (optional field, otpDetailsSchema), so forwarding this field
    // unconditionally would 502 any email signup with no phone but the WhatsApp
    // checkbox in some explicit state. Omit it outright when there's no phone
    // to attach it to.
    smsMarketingConsent: input.phone ? toMarketingConsent(acceptSmsMarketing) : undefined,
  };
}

type Deps = { adminCreate?: (input: CustomerCreateInput) => Promise<NewShopifyCustomer> };

export async function createShopifyCustomer(
  input: CustomerCreateInput,
  deps: Deps = {},
): Promise<NewShopifyCustomer> {
  const adminCreate = deps.adminCreate ?? defaultAdminCreate;
  return adminCreate(input);
}

async function defaultAdminCreate(input: CustomerCreateInput): Promise<NewShopifyCustomer> {
  const data = await shopifyAdminGraphQL<CustomerCreateData>(CREATE_CUSTOMER_MUTATION, {
    input: toShopifyInput(input),
  });
  const errors = data.customerCreate.userErrors;
  if (errors.length > 0) {
    // A single, unambiguous "already taken" error gets its own error so the
    // signup form can point at the actual field instead of a generic 502 —
    // anything else (multiple errors, a field-less one, or a single error that
    // ISN'T a duplicate — e.g. "Email is invalid") falls through to the
    // generic upstream failure below rather than guessing. UserError (the type
    // customerCreate actually returns) has no `code`, so message text is the
    // only signal that distinguishes "already taken" from every other single-
    // field validation error Shopify can return on the same field — checking
    // `field` alone here previously misreported a plain validation failure
    // (e.g. a malformed email) as "an account with this email already
    // exists", pointing the customer at logging in instead of fixing their input.
    if (errors.length === 1 && /already been taken/i.test(errors[0]?.message ?? '')) {
      const field = errors[0]?.field;
      if (field?.includes('email')) {
        throw new ConflictError('An account with this email already exists', {
          code: 'customer_email_taken',
        });
      }
      if (field?.includes('phone')) {
        throw new ConflictError('An account with this phone number already exists', {
          code: 'customer_phone_taken',
        });
      }
    }
    throw new UpstreamError(errors.map((e) => e.message).join('; '), {
      code: 'customer_create_failed',
    });
  }
  const customer = data.customerCreate.customer;
  if (!customer) {
    throw new UpstreamError('customerCreate returned no customer and no userErrors', {
      code: 'customer_create_failed',
    });
  }
  return customer;
}
