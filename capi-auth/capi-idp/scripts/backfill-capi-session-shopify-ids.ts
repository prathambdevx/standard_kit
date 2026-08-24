#!/usr/bin/env bun

/**
 * Backfill capi_sessions.shopify_id from each row's own id_token
 * ----------------------------------------------------------------------------
 * WHAT
 * The column shipped unpopulated, so every pre-existing row is NULL and the
 * customer -> sessions lookup (revoke-all-sessions, support, deletion requests)
 * is impossible. The value is already on the row: the id_token's `sub` claim.
 *
 * WHY NO SHOPIFY CALLS
 * Asking Shopify who each session belongs to would mean spending a refresh
 * token per row — most access tokens are long expired — which is slow, rate
 * limited, and risks live sessions. Decoding a JWT we already stored costs
 * nothing and touches no upstream. Parsing is not verifying, and that is
 * correct here: this token came from Shopify's token endpoint over TLS and is
 * read as a label, never for an auth decision.
 *
 * Stores the GID form (gid://shopify/Customer/<sub>) to match
 * customers.shopify_id — a bare numeric would join to zero rows, silently.
 *
 * HOW
 *   DATABASE_URL=postgres://... bun scripts/backfill-capi-session-shopify-ids.ts --dry-run
 *   Drop --dry-run to write. Only ever fills NULLs; never overwrites.
 */

import { SQL } from 'bun';

function toBunPostgresUrl(raw: string): string {
  const u = new URL(raw);
  u.searchParams.delete('schema'); // Prisma-only param; Bun's SQL rejects it
  return u.toString();
}

function customerGidFromIdToken(jwt: string | null): string | null {
  if (!jwt) return null;
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const { sub } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
    return sub ? `gid://shopify/Customer/${sub}` : null;
  } catch {
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = new SQL(toBunPostgresUrl(url));

  console.log(`mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE — will update rows'}`);

  const rows = await sql`
    select id, id_token from capi_sessions
    where shopify_id is null and id_token is not null`;
  console.log(`rows missing shopify_id (with an id_token): ${rows.length}`);

  const updates: { id: string; shopifyId: string }[] = [];
  let undecodable = 0;
  for (const r of rows) {
    const gid = customerGidFromIdToken(r.id_token as string);
    if (gid) updates.push({ id: r.id as string, shopifyId: gid });
    else undecodable++;
  }

  const distinct = new Set(updates.map((u) => u.shopifyId)).size;
  console.log(`resolvable: ${updates.length} | undecodable: ${undecodable}`);
  console.log(`distinct customers across those sessions: ${distinct}`);

  if (!dryRun) {
    let written = 0;
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      const payload = JSON.stringify(chunk.map((u) => ({ id: u.id, gid: u.shopifyId })));
      // Guard on `shopify_id is null` too: only ever fills a blank, never overwrites.
      const res = await sql`
        update capi_sessions as t
           set shopify_id = v.gid
          from jsonb_to_recordset(${payload}::text::jsonb) as v(id text, gid text)
         where t.id = v.id and t.shopify_id is null
        returning t.id`;
      written += res.length;
    }
    console.log(`updated: ${written}`);
  }

  const [after] = await sql`
    select count(*)::int total, count(shopify_id)::int with_shopify_id from capi_sessions`;
  console.log(`\nnow: ${after.with_shopify_id}/${after.total} rows have shopify_id`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
