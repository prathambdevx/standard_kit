// The custom OIDC identity provider — lets your own OTP-verified login act as
// Shopify's Customer Account API login provider. Framework-agnostic service
// logic (no Hono Context) — the HTTP layer (routes, cookies) lives in routes/.
//
// A real trap worth avoiding: don't derive the ID token's email from the
// Shopify customer id on the fly when Shopify has no email on file (e.g.
// `${sub}@otp.example.com`). Placeholder addresses are exactly what the signup
// gate exists to prevent (repositories/customers.ts's IdentityLookup) — a
// customer reaching this layer always has a real one. Always take the
// already-resolved local Customer row's `email` column.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { log } from '@devxcommerce/bff-core';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env';
import type { IdpAuthCode } from '../../repositories/idp_auth_codes';
import { saveCode, takeCode } from '../../repositories/idp_auth_codes';
import type { IdpInteraction } from '../../repositories/idp_interactions';
import {
  createInteraction,
  deleteInteraction,
  getInteraction,
} from '../../repositories/idp_interactions';
import { getRefresh, saveRefresh } from './session_store';
import { getSigningKey } from './signing_key';

const ACCESS_TTL_SECONDS = 3600;
const ID_TTL_SECONDS = 3600;

export function getDiscoveryDocument(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    end_session_endpoint: `${issuer}/logout`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    claims_supported: ['sub', 'email', 'email_verified', 'iss', 'aud', 'exp', 'iat', 'nonce'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  };
}

export async function getJwks() {
  const { publicJwk } = await getSigningKey();
  return { keys: [publicJwk] };
}

type AuthorizeParams = {
  clientId: string;
  redirectUri?: string;
  responseType?: string;
  state?: string;
  nonce?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export type AuthorizeResult =
  | { ok: true; interaction: IdpInteraction }
  | { ok: false; error: 'unauthorized_client' | 'invalid_request' };

/** Exact-match allowlist for redirect targets — parsed per call so a config change needs no redeploy. */
export function allowedRedirectUris(): string[] {
  return (env.IDP_ALLOWED_REDIRECT_URIS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Exact string match, never prefix/startsWith — `https://ok.example` must not admit `https://ok.example.evil.tld`. */
export function isAllowedRedirectUri(uri: string | undefined): boolean {
  return !!uri && allowedRedirectUris().includes(uri);
}

export async function startAuthorize(params: AuthorizeParams): Promise<AuthorizeResult> {
  if (!env.IDP_CLIENT_ID || params.clientId !== env.IDP_CLIENT_ID) {
    return { ok: false, error: 'unauthorized_client' };
  }
  if (!params.redirectUri || params.responseType !== 'code') {
    return { ok: false, error: 'invalid_request' };
  }
  // Fails closed while the allowlist is unset: an unconfigured IdP must not be
  // an open code-exfiltration endpoint.
  if (!isAllowedRedirectUri(params.redirectUri)) {
    // Logged because a legitimate-but-unlisted callback URL is indistinguishable
    // from an attack at the HTTP layer, and the only way to tell is to see the
    // value that was refused next to the list it was compared against.
    log.warn(
      { redirectUri: params.redirectUri, allowed: allowedRedirectUris() },
      'idp/authorize refused a redirect_uri that is not on IDP_ALLOWED_REDIRECT_URIS',
    );
    return { ok: false, error: 'invalid_request' };
  }
  const interaction = await createInteraction({
    id: `int_${randomUUID()}`,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    state: params.state ?? '',
    nonce: params.nonce ?? '',
    scope: params.scope ?? 'openid email',
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
  });
  return { ok: true, interaction };
}

type ResolvedCustomer = { shopifyId: string; email: string };

export type CompleteResult = { ok: true; redirectUrl: string } | { ok: false; error: string };

/** Called once phone-OTP has resolved the customer for a pending interaction — issues a one-time auth code and the redirect back to Shopify. */
export async function completeInteraction(
  interactionId: string | undefined,
  customer: ResolvedCustomer,
): Promise<CompleteResult> {
  const interaction = await getInteraction(interactionId);
  if (!interaction) return { ok: false, error: 'no_interaction' };

  const sub = customer.shopifyId.replace('gid://shopify/Customer/', '');
  const code = newOpaqueId();
  await saveCode({
    code,
    clientId: interaction.clientId,
    redirectUri: interaction.redirectUri,
    nonce: interaction.nonce,
    codeChallenge: interaction.codeChallenge ?? undefined,
    sub,
    email: customer.email,
  });
  await deleteInteraction(interaction.id);

  const url = new URL(interaction.redirectUri);
  url.searchParams.set('code', code);
  if (interaction.state) url.searchParams.set('state', interaction.state);
  return { ok: true, redirectUrl: url.toString() };
}

// Constant-time, and hashed first so unequal lengths neither throw
// (timingSafeEqual requires equal-length buffers) nor leak the secret's length.
// Same standard services/otp_engine/index.ts's hashesMatch applies to OTP codes — a
// plain === here leaks how many leading characters of the secret matched.
function secretMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  return timingSafeEqual(
    createHash('sha256').update(candidate).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

export function authenticateClient(input: {
  basicAuthHeader?: string;
  bodyClientId?: string;
  bodyClientSecret?: string;
}): boolean {
  if (!env.IDP_CLIENT_ID || !env.IDP_CLIENT_SECRET) return false;
  if (input.basicAuthHeader?.startsWith('Basic ')) {
    const [id, secret] = Buffer.from(input.basicAuthHeader.slice(6), 'base64')
      .toString('utf8')
      .split(':');
    // client_id is a public value, so a plain compare is fine for it.
    return id === env.IDP_CLIENT_ID && secretMatches(secret, env.IDP_CLIENT_SECRET);
  }
  return (
    input.bodyClientId === env.IDP_CLIENT_ID &&
    secretMatches(input.bodyClientSecret, env.IDP_CLIENT_SECRET)
  );
}

async function signIdToken(
  issuer: string,
  claims: { sub: string; email: string; aud: string; nonce: string },
): Promise<string> {
  const { privateKey, kid } = await getSigningKey();
  return new SignJWT({ email: claims.email, email_verified: true, nonce: claims.nonce })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(issuer)
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt()
    .setExpirationTime(`${ID_TTL_SECONDS}s`)
    .sign(privateKey);
}

async function signAccessToken(issuer: string, sub: string, email: string): Promise<string> {
  const { privateKey, kid } = await getSigningKey();
  return new SignJWT({ email, token_use: 'access' })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(issuer)
    .setSubject(sub)
    .setAudience(`${issuer}/userinfo`)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(privateKey);
}

type TokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: 'Bearer';
  expires_in: number;
};

export async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  issuer: string;
}): Promise<{ ok: true; tokens: TokenResponse } | { ok: false; error: string }> {
  const rec = await takeCode(input.code);
  if (!rec) return { ok: false, error: 'invalid_grant' };
  if (rec.redirectUri !== input.redirectUri) {
    return { ok: false, error: 'invalid_grant' };
  }
  if (rec.codeChallenge && !pkceMatches(rec, input.codeVerifier)) {
    return { ok: false, error: 'invalid_grant' };
  }

  const id_token = await signIdToken(input.issuer, {
    sub: rec.sub,
    email: rec.email,
    aud: rec.clientId,
    nonce: rec.nonce,
  });
  const access_token = await signAccessToken(input.issuer, rec.sub, rec.email);
  const refresh_token = newOpaqueId();
  await saveRefresh(refresh_token, { clientId: rec.clientId, sub: rec.sub, email: rec.email });

  return {
    ok: true,
    tokens: {
      access_token,
      id_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
    },
  };
}

function pkceMatches(rec: IdpAuthCode, codeVerifier: string | undefined): boolean {
  if (!codeVerifier) return false;
  const challenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return challenge === rec.codeChallenge;
}

export async function exchangeRefreshToken(input: {
  refreshToken: string;
  issuer: string;
}): Promise<{ ok: true; tokens: TokenResponse } | { ok: false; error: string }> {
  const rt = await getRefresh(input.refreshToken);
  if (!rt?.email) return { ok: false, error: 'invalid_grant' };
  const access_token = await signAccessToken(input.issuer, rt.sub, rt.email);
  const id_token = await signIdToken(input.issuer, {
    sub: rt.sub,
    email: rt.email,
    aud: rt.clientId,
    nonce: '',
  });
  return {
    ok: true,
    tokens: { access_token, id_token, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS },
  };
}

export async function getUserinfo(
  bearerToken: string,
  issuer: string,
): Promise<{ sub: string; email: string; email_verified: true } | null> {
  try {
    const { publicJwk } = await getSigningKey();
    const { importJWK } = await import('jose');
    const key = await importJWK(publicJwk, 'RS256');
    // Audience + token_use are both checked, not just the issuer: id tokens are
    // signed with the same key and issuer and also carry sub + email, so an
    // issuer-only check let an id_token be replayed here as an access token.
    const { payload } = await jwtVerify(bearerToken, key, {
      issuer,
      audience: `${issuer}/userinfo`,
    });
    if (payload.token_use !== 'access') return null;
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return { sub: payload.sub, email: payload.email, email_verified: true };
  } catch {
    return null;
  }
}

function newOpaqueId(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}
