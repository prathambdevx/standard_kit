import type { Customer } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';

// Prisma's driver-adapter (@prisma/adapter-pg) surfaces the violated column here
// instead of the classic meta.target — checking both keeps this working if that changes.
function collidedOn(err: Prisma.PrismaClientKnownRequestError, field: string): boolean {
  const meta = err.meta as
    | { driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } }; target?: string[] }
    | undefined;
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target ?? [];
  return fields.includes(field);
}

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
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;

      // Same race as findOrLazyFillByPhone/middleware/customer.ts's resolveCustomer:
      // two first-hit requests can both pass the findUnique check before either commits.
      const winner = await prisma().customer.findUnique({
        where: { shopifyId: input.shopifyId },
      });
      if (winner) return winner;

      // A Shopify customer was already minted by this point, so a different local row
      // owning this number must degrade the signup, not fail it — otherwise the caller
      // is left with a live Shopify account and no local row at all.
      if (input.phone && collidedOn(err, 'phone')) {
        return prisma()
          .customer.upsert({
            where: { email: input.email },
            create: { ...input, phone: null },
            update: { shopifyId: input.shopifyId, name: input.name },
          })
          .catch(async (retryErr) => {
            // The retry is a second write, so it can hit the same shopifyId race.
            if (
              retryErr instanceof Prisma.PrismaClientKnownRequestError &&
              retryErr.code === 'P2002'
            ) {
              const retryWinner = await prisma().customer.findUnique({
                where: { shopifyId: input.shopifyId },
              });
              if (retryWinner) return retryWinner;
            }
            throw retryErr;
          });
      }
      throw err;
    });
}
