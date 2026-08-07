import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, type JWK } from 'jose';
import { env } from '../../config/env';

// jose v6 signs with a WebCrypto CryptoKey (or raw bytes); it dropped KeyLike.
type SignKey = CryptoKey | Uint8Array;

interface LoadedKey {
  privateKey: SignKey;
  publicJwk: JWK; // with kid/use/alg — safe to publish in the JWKS
  kid: string;
}

// Only used in dev/CI (never production — see readKeySource below).
const DEV_KEY_FILE = join(process.cwd(), '.idp-keys.dev.json');

let loaded: LoadedKey | null = null;

/** RS256 signing key for the IdP's JWKS. Reads IDP_SIGNING_KEY in every
 *  env; in dev/CI, an unset var falls back to a keypair generated once and
 *  cached to a gitignored file so restarts don't invalidate cached JWKS. */
export async function getSigningKey(): Promise<LoadedKey> {
  if (loaded) return loaded;
  loaded = await readKeySource();
  return loaded;
}

async function readKeySource(): Promise<LoadedKey> {
  if (env.IDP_SIGNING_KEY) {
    const privateJwk = JSON.parse(env.IDP_SIGNING_KEY) as JWK;
    return jwkToLoadedKey(privateJwk);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'IDP_SIGNING_KEY is required in production — refusing to generate a ' +
        "throwaway key that would invalidate Shopify's cached JWKS on every restart",
    );
  }
  return devFileKey();
}

async function devFileKey(): Promise<LoadedKey> {
  if (existsSync(DEV_KEY_FILE)) {
    const privateJwk = JSON.parse(readFileSync(DEV_KEY_FILE, 'utf8')) as JWK;
    return jwkToLoadedKey(privateJwk);
  }
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  writeFileSync(DEV_KEY_FILE, JSON.stringify(privateJwk, null, 2), { mode: 0o600 });
  return jwkToLoadedKey(privateJwk);
}

/** Test-only — clears the module key cache so cases don't leak a key across tests. */
export function resetSigningKeyForTests(): void {
  loaded = null;
}

async function jwkToLoadedKey(privateJwk: JWK): Promise<LoadedKey> {
  const privateKey = (await importJWK(privateJwk, 'RS256')) as SignKey;
  // The public half is just the non-secret fields of the same JWK (n, e, kty)
  // — no separate public key needs to be stored or derived via node:crypto.
  const publicHalf: JWK = {
    kty: privateJwk.kty,
    n: privateJwk.n,
    e: privateJwk.e,
  };
  // kid is the RFC 7638 thumbprint of the key itself, NOT a constant. A constant
  // meant a rotated key kept the same label, so Shopify — which caches our JWKS
  // — kept verifying against the OLD public key and 401'd every login until its
  // cache happened to expire. Observed live 2026-08-06: a rotation appeared fine
  // when tested seconds later, then broke logins ~25 minutes on. Deriving the kid
  // makes a new key announce itself as a new key, so Shopify refetches.
  const kid = await calculateJwkThumbprint(publicHalf, 'sha256');
  const publicJwk: JWK = { ...publicHalf, kid, use: 'sig', alg: 'RS256' };
  return { privateKey, publicJwk, kid };
}
