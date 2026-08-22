import { resolveMx as nodeResolveMx } from 'node:dns/promises';

// A cold lookup on a real domain can take over a second (measured: devxlabs.ai
// took 1053ms uncached) — 800ms would misclassify real domains as inconclusive.
const MX_LOOKUP_TIMEOUT_MS = 1500;

export type DomainCheckResult = 'deliverable' | 'undeliverable' | 'inconclusive';

let resolveMxImpl = nodeResolveMx;

/** Test-only swap for the real DNS lookup, mirroring initShopify's fetchImpl override. */
export function setResolveMxForTests(fn: typeof nodeResolveMx | null): void {
  resolveMxImpl = fn ?? nodeResolveMx;
}

/** MX lookup on the email's domain. A timeout or resolver hiccup is 'inconclusive', never
 *  'undeliverable' — DNS flakiness is not evidence the domain itself can't receive mail. */
export async function checkEmailDomain(
  email: string,
  deps: { resolveMx?: typeof nodeResolveMx; timeoutMs?: number } = {},
): Promise<DomainCheckResult> {
  const domain = email.split('@')[1];
  if (!domain) return 'inconclusive';
  const lookup = deps.resolveMx ?? resolveMxImpl;
  try {
    const records = await Promise.race([
      lookup(domain),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('mx_lookup_timeout')),
          deps.timeoutMs ?? MX_LOOKUP_TIMEOUT_MS,
        ),
      ),
    ]);
    return records.length > 0 ? 'deliverable' : 'undeliverable';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'ENOTFOUND' || code === 'ENODATA' ? 'undeliverable' : 'inconclusive';
  }
}
