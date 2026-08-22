// The opening move of a CAPI handshake — PKCE, state and the authorize URL —
// for the browser/webview handoff (routes/capi_handlers.ts). If you ever add a
// second caller (e.g. a native-app HTTP client walking the same handoff
// itself), this is the shared entry point both would use.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { type PendingAuth, putPending } from '../idp/session_store';

export interface CapiHandshakeConfig {
  authorizeEndpoint: string;
  redirectUri: string;
  scope: string;
  clientId: string;
}

// codeVerifier and redirectUri are owned by this function; everything else on
// the pending record (bindHash, returnTo, grantToken) is the caller's business.
export type CapiHandshakeExtras = Omit<PendingAuth, 'codeVerifier' | 'redirectUri'>;

/** Mints PKCE + state, writes the pending record, and returns Shopify's authorize URL. */
export async function beginCapiHandshake(
  cfg: CapiHandshakeConfig,
  extras: CapiHandshakeExtras = {},
): Promise<{ authorizeUrl: string; state: string }> {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomUUID();

  await putPending(state, { codeVerifier, redirectUri: cfg.redirectUri, ...extras });

  const url = new URL(cfg.authorizeEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { authorizeUrl: url.toString(), state };
}
