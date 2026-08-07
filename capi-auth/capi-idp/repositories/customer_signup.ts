import type { Customer } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';

type CreateInput = {
  shopifyId: string;
  name: string;
  email: string;
  phone: string | null;
};

/** Creates the local Customer row for a brand-new Shopify signup (B8) — mirrors findOrLazyFillByPhone's upsert-with-P2002-race-catch pattern in a separate function, so that already-approved file stays untouched. */
export async function createCustomerFromSignup(input: CreateInput): Promise<Customer> {
  const existing = await prisma().customer.findUnique({ where: { shopifyId: input.shopifyId } });
  if (existing) return existing;

  return prisma()
    .customer.upsert({
      where: { email: input.email },
      create: input,
      update: { shopifyId: input.shopifyId, name: input.name, phone: input.phone },
    })
    .catch(async (err) => {
      // Same race as findOrLazyFillByPhone/middleware/customer.ts's resolveCustomer:
      // two first-hit requests can both pass the findUnique check before either commits.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await prisma().customer.findUnique({
          where: { shopifyId: input.shopifyId },
        });
        if (winner) return winner;
      }
      throw err;
    });
}
