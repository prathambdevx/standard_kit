import type { Customer } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { isWellFormedEmail } from '../email-domain';
import {
  type AdminCustomer,
  findCustomerByEmail,
  findCustomerByPhone,
} from '../services/shopify/admin/customer-lookup';

type Deps = {
  adminFindByPhone?: (phone: string) => ReturnType<typeof findCustomerByPhone>;
  adminFindByEmail?: (email: string) => ReturnType<typeof findCustomerByEmail>;
};

/**
 * The invariant this kit enforces: every customer has a usable EMAIL. Phone is
 * optional — it's an OTP login identifier when present, but email is the channel
 * that actually has to work (order confirmations, receipts, marketing), so it's
 * the one worth blocking on. Shopify requires neither (a customer with both null
 * is accepted by customerCreate, verified live), so this auth layer is the only
 * place the rule can live.
 *
 * `incomplete` is a customer Shopify already knows who has no usable email. They
 * are NOT logged in; they go through the details form to supply one, which
 * patches their EXISTING Shopify record (customerUpdate) so their orders and
 * addresses stay attached. That one gate replaces a synthetic-placeholder scheme
 * plus an orders/paid healing webhook. Only the phone channel can produce it —
 * an email-channel login has, by definition, just proven a usable address.
 */
export type IdentityLookup =
  | { status: 'ready'; customer: Customer }
  | { status: 'incomplete'; admin: AdminCustomer }
  | { status: 'new' };

/** Email counterpart of findOrLazyFillByPhone, for the email OTP channel. Never returns
 *  `incomplete`: the OTP just proved a usable address, which is the only thing the gate
 *  requires. A missing phone is fine — it lazily fills from Shopify if one is on file. */
export async function findOrLazyFillByEmail(
  email: string,
  deps: Deps = {},
): Promise<IdentityLookup> {
  const cached = await prisma().customer.findUnique({ where: { email } });
  if (cached?.shopifyId) return { status: 'ready', customer: cached };

  const adminFindByEmail = deps.adminFindByEmail ?? findCustomerByEmail;
  const admin = await adminFindByEmail(email);
  // null even for an orphaned cached row — Shopify has no match, so this is
  // a genuinely new signup, not an existing customer with no shopifyId.
  if (!admin) return { status: 'new' };

  // A cached row with no shopifyId gets patched in place by id — not the
  // upsert-by-key path below, which could miss it on a case mismatch.
  if (cached) {
    const customer = await prisma()
      .customer.update({
        where: { id: cached.id },
        data: { shopifyId: admin.id, name: admin.name, phone: admin.phone },
      })
      .catch(async (err) => {
        // shopifyId is @unique — another row may already own it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await prisma().customer.findUnique({ where: { shopifyId: admin.id } });
          if (winner) return winner;
        }
        throw err;
      });
    return { status: 'ready', customer };
  }

  // Key on Shopify's canonical address, not the string the client typed —
  // Shopify's search is case-insensitive but Postgres VarChar equality is not,
  // so upserting on "Foo@Bar.com" would create a second row alongside an
  // existing "foo@bar.com" one and split that customer's wishlist and reviews.
  const key = admin.email ?? email;
  const byShopifyId = await prisma().customer.findUnique({ where: { shopifyId: admin.id } });
  if (byShopifyId) {
    if (byShopifyId.email === key && byShopifyId.phone === admin.phone) {
      return { status: 'ready', customer: byShopifyId };
    }
    const customer = await prisma()
      .customer.update({
        where: { id: byShopifyId.id },
        data: { email: key, phone: admin.phone },
      })
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
    return { status: 'ready', customer };
  }
  const customer = await prisma()
    .customer.upsert({
      where: { email: key },
      create: { shopifyId: admin.id, name: admin.name, email: key, phone: admin.phone },
      update: { shopifyId: admin.id, name: admin.name, phone: admin.phone },
    })
    .catch(async (err) => {
      // Same first-hit race as findOrLazyFillByPhone below.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await prisma().customer.findUnique({ where: { shopifyId: admin.id } });
        if (winner) return winner;
      }
      throw err;
    });
  return { status: 'ready', customer };
}

/** Resolves a verified phone, lazily writing it back to Postgres on a cache miss
 *  instead of a batch backfill — a hit needs no Shopify Admin call at all. The
 *  phone is proven by the OTP, so `incomplete` here means no usable email on file. */
export async function findOrLazyFillByPhone(
  phoneE164: string,
  deps: Deps = {},
): Promise<IdentityLookup> {
  const cached = await prisma().customer.findUnique({ where: { phone: phoneE164 } });
  // Re-gates on either a stale email or a missing shopifyId — Shopify is
  // the source of truth for whether a real link exists now.
  if (cached?.shopifyId && isWellFormedEmail(cached.email)) {
    return { status: 'ready', customer: cached };
  }

  const adminFindByPhone = deps.adminFindByPhone ?? findCustomerByPhone;
  const admin = await adminFindByPhone(phoneE164);
  // Same as findOrLazyFillByEmail: null even for an orphaned row.
  if (!admin) return { status: 'new' };
  if (!isWellFormedEmail(admin.email)) return { status: 'incomplete', admin };

  const email = admin.email as string;

  // A cached row missing shopifyId gets patched in place — avoids the
  // upsert-by-email path below, which could target a different row.
  if (cached && !cached.shopifyId) {
    const customer = await prisma()
      .customer.update({
        where: { id: cached.id },
        data: { shopifyId: admin.id, name: admin.name, email, phone: phoneE164 },
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return cached;
        }
        throw err;
      });
    return { status: 'ready', customer };
  }

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
  // Its email may also be a stale synthetic value from before this rule.
  if (!row.phone || row.email !== email) {
    const customer = await prisma()
      .customer.update({ where: { id: row.id }, data: { phone: phoneE164, email } })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return row;
        }
        throw err;
      });
    return { status: 'ready', customer };
  }
  return { status: 'ready', customer: row };
}
