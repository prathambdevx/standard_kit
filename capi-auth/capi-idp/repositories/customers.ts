import type { Customer } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import {
  findCustomerByEmail,
  findCustomerByPhone,
} from '../services/shopify/admin/customer-lookup';
import {
  isSyntheticEmail,
  setShopifyCustomerEmail,
  syntheticEmailForPhone,
} from '../services/shopify/admin/synthetic-email';

type Deps = {
  adminFindByPhone?: (phone: string) => ReturnType<typeof findCustomerByPhone>;
  adminFindByEmail?: (email: string) => ReturnType<typeof findCustomerByEmail>;
};

/** Email counterpart of findOrLazyFillByPhone, for the email OTP channel. Same
 *  local-hit → Admin-lookup → upsert shape; no phone is written because the
 *  Admin customer search returns none, so Customer.phone stays null until a
 *  later phone login lazy-fills it. Returns null when Shopify has no customer
 *  for the address, which is the genuine new-signup case. */
export async function findOrLazyFillByEmail(
  email: string,
  deps: Deps = {},
): Promise<Customer | null> {
  const cached = await prisma().customer.findUnique({ where: { email } });
  if (cached) return cached;

  const adminFindByEmail = deps.adminFindByEmail ?? findCustomerByEmail;
  const admin = await adminFindByEmail(email);
  if (!admin) return null;

  // Key on Shopify's canonical address, not the string the client typed —
  // Shopify's search is case-insensitive but Postgres VarChar equality is not,
  // so upserting on "Foo@Bar.com" would create a second row alongside an
  // existing "foo@bar.com" one and split that customer's wishlist and reviews.
  const key = admin.email ?? email;
  // A phone-first signup stores a SYNTHETIC address (syntheticEmailForPhone), so
  // a later real-email login misses the findUnique above and lands here by
  // shopifyId — returning the row still carrying the synthetic value, which the
  // caller then forwards into the IdP/CAPI handshake as the customer's identity.
  // Reconcile to Shopify's canonical address instead of handing back the stale one.
  const byShopifyId = await prisma().customer.findUnique({ where: { shopifyId: admin.id } });
  if (byShopifyId) {
    if (byShopifyId.email === key) return byShopifyId;
    return prisma()
      .customer.update({ where: { id: byShopifyId.id }, data: { email: key } })
      .catch((err) => {
        // email is @unique, so a separate row may already hold the canonical
        // address (e.g. an import that never learned a shopifyId). Merging the
        // two is a data decision, not this function's call — keep the row we
        // resolved rather than 502-ing a login over it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return byShopifyId;
        }
        throw err;
      });
  }
  return await prisma()
    .customer.upsert({
      where: { email: key },
      create: { shopifyId: admin.id, name: admin.name, email: key },
      update: { shopifyId: admin.id, name: admin.name },
    })
    .catch(async (err) => {
      // Same first-hit race as findOrLazyFillByPhone below.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await prisma().customer.findUnique({ where: { shopifyId: admin.id } });
        if (winner) return winner;
      }
      throw err;
    });
}

export type EmailReconcileResult =
  | 'updated'
  | 'no_local_row' // we've never seen this Shopify customer
  | 'already_real' // never overwrite a genuine address
  | 'not_a_real_email' // the order carried nothing usable
  | 'conflict'; // that address belongs to another customer — a merge, not our call

/**
 * Replaces a stored SYNTHETIC email with the real one a customer typed at checkout,
 * in both Postgres and Shopify.
 *
 * Phone-first customers with no email on file are given a synthetic placeholder
 * (syntheticEmailForPhone) because Shopify requires an address. Nothing used to
 * learn their real one: every ORDER carried it, but their customer record never
 * did — so support couldn't find them by email, marketing had a dead address,
 * `/v1/customer/account` showed them the placeholder as their own email, and they
 * could never log in by email. orders/paid is the one place that reliably has both
 * the customer and a real address.
 *
 * Deliberately narrow: only ever overwrites an address `isSyntheticEmail()`
 * recognises. A guest checkout, a gift order, or someone using a work address must
 * never clobber a good account email.
 */
export async function reconcileRealEmail(
  input: { shopifyCustomerGid: string; realEmail: string | null | undefined },
  deps: { setShopifyEmail?: (customerId: string, email: string) => Promise<void> } = {},
): Promise<EmailReconcileResult> {
  const real = input.realEmail?.trim().toLowerCase();
  // A synthetic address on the ORDER is not a real one — that's the placeholder
  // coming back at us, which would be a no-op write and a misleading log line.
  if (!real?.includes('@') || isSyntheticEmail(real)) return 'not_a_real_email';

  const row = await prisma().customer.findUnique({
    where: { shopifyId: input.shopifyCustomerGid },
  });
  if (!row) return 'no_local_row';
  if (!isSyntheticEmail(row.email)) return 'already_real';

  // Shopify first: if it rejects the address as a duplicate, our row must keep the
  // synthetic value so the two stay consistent. The reverse order would leave
  // Postgres claiming an address Shopify never accepted.
  const setShopifyEmail = deps.setShopifyEmail ?? setShopifyCustomerEmail;
  try {
    await setShopifyEmail(input.shopifyCustomerGid, real);
  } catch {
    return 'conflict';
  }

  try {
    await prisma().customer.update({ where: { id: row.id }, data: { email: real } });
  } catch (err) {
    // Another local row already holds this address (an import that never learned a
    // shopifyId, say). Merging two customers is a data decision, not a webhook's.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return 'conflict';
    }
    throw err;
  }
  return 'updated';
}

/** Resolves a verified phone to a local Customer row, lazily writing the phone
 *  back to Postgres on a cache miss instead of a batch backfill —
 *  a hit needs no Shopify Admin call at all. Returns null when Shopify itself
 *  has no customer for this phone. */
export async function findOrLazyFillByPhone(
  phoneE164: string,
  deps: Deps = {},
): Promise<Customer | null> {
  const cached = await prisma().customer.findUnique({ where: { phone: phoneE164 } });
  if (cached) return cached;

  const adminFindByPhone = deps.adminFindByPhone ?? findCustomerByPhone;
  const admin = await adminFindByPhone(phoneE164);
  if (!admin) return null;

  const email = admin.email ?? syntheticEmailForPhone(phoneE164);
  const row =
    (await prisma().customer.findUnique({ where: { shopifyId: admin.id } })) ??
    (await prisma()
      .customer.upsert({
        where: { email },
        create: { shopifyId: admin.id, name: admin.name, email, phone: phoneE164 },
        update: { shopifyId: admin.id, name: admin.name, phone: phoneE164 },
      })
      .catch(async (err) => {
        // Same race as middleware/customer.ts's resolveCustomer: two first-hit
        // requests can both pass the findUnique check before either commits.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await prisma().customer.findUnique({ where: { shopifyId: admin.id } });
          if (winner) return winner;
        }
        throw err;
      }));

  // The row may have existed already (found by shopifyId, created before phone
  // was tracked) without the phone column filled — that's the actual lazy-fill.
  if (!row.phone) {
    return prisma().customer.update({ where: { id: row.id }, data: { phone: phoneE164 } });
  }
  return row;
}
