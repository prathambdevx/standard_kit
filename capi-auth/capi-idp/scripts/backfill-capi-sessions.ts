#!/usr/bin/env bun

/**
 * Backfill legacy Redis CAPI sessions → Postgres (capi_sessions)
 * ----------------------------------------------------------------------------
 * WHAT
 * Sessions minted by the kit's earlier Redis-backed store live only under
 * `capiauth:capi_session:<id>`. The app can migrate them lazily on a customer's
 * first authenticated request, but that leaves a tail as long as the old TTL,
 * during which the fallback code must stay. This copies them all forward at once.
 *
 * WHY IT CANNOT LOG ANYONE OUT
 *   - Reads with GET, never GETDEL.
 *   - Writes with ON CONFLICT DO NOTHING, so a row the app already migrated (or
 *     refreshed to a NEWER token) is never overwritten with our stale read.
 *   - NEVER deletes a Redis key. getCapiSession checks Postgres first, so once
 *     the row exists Redis is simply never consulted; the key expires on its own.
 * Every failure mode therefore degrades to "the lazy path handles it later".
 *
 * HOW
 *   DATABASE_URL=postgres://... REDIS_URL=redis://host:port/2 \
 *     bun scripts/backfill-capi-sessions.ts --dry-run
 *   Drop --dry-run to write. --limit=N caps how many keys are considered.
 */

import Redis from 'ioredis';
import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const LEGACY_PREFIX = 'capiauth:capi_session:';

// Must match whatever your old writer produced. NOTE: .optional() rejects null —
// if any writer stored `idToken: null` rather than omitting it, widen this to
// .nullish(), or those sessions are skipped and those customers log in again.
const legacyRecordSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1).optional(),
  expiresAt: z.number().int().positive(),
});

const storedId = (raw: string) => createHash('sha256').update(raw).digest('hex');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// Prisma-style URLs carry ?schema=, which Bun's SQL rejects as a server GUC.
// Drop this helper if you connect with Prisma or node-postgres instead.
function toBunPostgresUrl(raw: string): string {
  const u = new URL(raw);
  u.searchParams.delete('schema');
  return u.toString();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Number.POSITIVE_INFINITY;

  const redis = new Redis(requireEnv('REDIS_URL'), { lazyConnect: true });
  await redis.connect();
  const sql = new SQL(toBunPostgresUrl(requireEnv('DATABASE_URL')));

  console.log(`mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE — will insert rows'}`);

  let cursor = '0';
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${LEGACY_PREFIX}*`, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0' && keys.length < limit);

  const considered = keys.slice(0, Number.isFinite(limit) ? limit : keys.length);
  console.log(`legacy keys found: ${keys.length}${considered.length !== keys.length ? ` (considering ${considered.length})` : ''}`);

  const stats = { inserted: 0, alreadyPresent: 0, malformed: 0, vanished: 0, failed: 0 };

  // Bulk, not per-key: one MGET, one id SELECT, chunked inserts. Per-key round
  // trips are latency-bound over an SSH tunnel (~2 RTT x N), not volume-bound.
  const rawIds = considered.map((k) => k.slice(LEGACY_PREFIX.length));
  const values = considered.length > 0 ? await redis.mget(...considered) : [];

  type Candidate = { id: string; rec: z.infer<typeof legacyRecordSchema> };
  const candidates: Candidate[] = [];

  for (let i = 0; i < considered.length; i++) {
    const raw = values[i];
    if (!raw) {
      // Expired or migrated by the app between our SCAN and this MGET.
      stats.vanished++;
      continue;
    }
    try {
      const result = legacyRecordSchema.safeParse(JSON.parse(raw));
      if (!result.success) {
        stats.malformed++;
        continue;
      }
      candidates.push({ id: storedId(rawIds[i]), rec: result.data });
    } catch {
      stats.malformed++;
    }
  }

  const ids = candidates.map((c) => c.id);
  const present = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const rows = await sql`select id from capi_sessions where id in ${sql(chunk)}`;
    for (const r of rows) present.add(r.id as string);
  }

  const toInsert = candidates.filter((c) => !present.has(c.id));
  stats.alreadyPresent = candidates.length - toInsert.length;

  if (dryRun) {
    stats.inserted = toInsert.length;
  } else {
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500).map((c) => ({
        id: c.id,
        access_token: c.rec.accessToken,
        refresh_token: c.rec.refreshToken,
        id_token: c.rec.idToken ?? null,
        expires_at: new Date(c.rec.expiresAt * 1000),
        last_used_at: null,
      }));
      try {
        const res = await sql`
          insert into capi_sessions ${sql(chunk, 'id', 'access_token', 'refresh_token', 'id_token', 'expires_at', 'last_used_at')}
          on conflict (id) do nothing
          returning id`;
        stats.inserted += res.length;
        stats.alreadyPresent += chunk.length - res.length;
      } catch (err) {
        stats.failed += chunk.length;
        console.error('chunk insert failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  console.log('\n--- result ---');
  console.log(`${dryRun ? 'would insert' : 'inserted'}      : ${stats.inserted}`);
  console.log(`already in Postgres : ${stats.alreadyPresent}`);
  console.log(`malformed (skipped) : ${stats.malformed}`);
  console.log(`vanished mid-run    : ${stats.vanished}`);
  console.log(`insert failures     : ${stats.failed}`);
  console.log('\nno Redis key was deleted; none will be.');

  await redis.quit();
  await sql.end();
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
