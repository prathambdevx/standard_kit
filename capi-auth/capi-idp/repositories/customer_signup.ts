import type { Customer } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';

type CreateInput = {
  shopifyId: string;
  name: string;
  email: string;
  phone: string | null;
};

/** Creates the local Customer row for a completed signup — or refreshes an existing one,
 *  since the same handler now also completes an INCOMPLETE profile (an existing Shopify
 *  customer who just supplied their missing email/phone), where a row may already exist
 *  holding the stale value. Mirrors findOrLazyFillByPhone's upsert-with-P2002-race-catch. */
export async function createCustomerFromSignup(input: CreateInput): Promise<Customer> {
  const existing = await prisma().customer.findUnique({ where: { shopifyId: input.shopifyId } });
  if (existing) {
    if (existing.email === input.email && existing.phone === input.phone) return existing;
    return prisma()
      .customer.update({
        where: { id: existing.id },
        data: { name: input.name, email: input.email, phone: input.phone },
      })
      .catch((err) => {
        // Another row already holds this address — a merge decision, not this
        // function's call. Keep what we resolved rather than failing the signup.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return existing;
        }
        throw err;
      });
  }

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
