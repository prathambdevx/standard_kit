// The BFF as an OAuth *client* of Shopify's Customer Account API (CAPI) —
// the mirror image of services/idp/provider.ts, which is the authorization
// server our own custom IdP runs. There, Shopify is the relying party
// exchanging a code with us; here, the BFF is the relying party exchanging
// a code (that Shopify's CAPI login flow produced, after routing through our
// IdP) for CAPI access/ID/refresh tokens.
//
// The token endpoint is intentionally NOT hardcoded here. Shopify's own docs
// describe it as discovered per-shop via `{shopDomain}/.well-known/openid-
// configuration` (`token_endpoint`, shaped `https://{shopDomain}/authentication/
// oauth/token`), while other secondary sources describe a different
// `shopify.com/{shop_id}/...` form — those two disagree, so guessing one would
// risk silently hitting a dead URL. The caller supplies it via config
// (CAPI_TOKEN_ENDPOINT) — resolve it once via discovery for your own store
// and hardcode the result, rather than guessing at request time.
import { UpstreamError } from '@devxcommerce/bff-core';
import { z } from 'zod';
import { env } from '../../config/env';
import { upstreamFetch } from '../upstream-fetch';

const tokenResponseSchema = z
  .object({
    access_token: z.string(),
    // Absent on a refresh_token grant per Shopify's docs (id token is only
    // reissued on the initial authorization_code exchange).
    id_token: z.string().optional(),
    refresh_token: z.string().optional(),
    token_type: z.string(),
    expires_in: z.number(),
  })
  .passthrough();

export type CapiTokenResponse = z.infer<typeof tokenResponseSchema>;

export type CapiClientDeps = {
  fetchImpl?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
};

function resolveClientId(deps: CapiClientDeps): string {
  const clientId = deps.clientId ?? env.CAPI_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'CAPI_CLIENT_ID is not set — the CAPI OAuth client id is registered ' +
        'on the Shopify side once this is wired up, not something to default silently',
    );
  }
  return clientId;
}

// Confidential clients (server-side, e.g. this BFF) authenticate with Basic
// base64(client_id:client_secret); public/PKCE-only clients send no secret at
// all. Whether your own registration ends up confidential or public depends
// on how you register it with Shopify — the secret is optional here and its
// presence alone decides which shape is sent.
function authHeader(deps: CapiClientDeps, clientId: string): Record<string, string> {
  const clientSecret = deps.clientSecret ?? env.CAPI_CLIENT_SECRET;
  if (!clientSecret) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
  };
}

async function parseTokenResponse(res: Response): Promise<CapiTokenResponse> {
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new UpstreamError('Shopify CAPI token response shape drift', {
      code: 'capi_token_shape',
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function postToken(
  tokenEndpoint: string,
  body: URLSearchParams,
  deps: CapiClientDeps,
  operation: string,
  errorCode: string,
): Promise<CapiTokenResponse> {
  const res = await upstreamFetch({
    upstream: 'shopify-caapi',
    operation,
    code: errorCode,
    url: tokenEndpoint,
    fetchImpl: deps.fetchImpl,
    write: true,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...authHeader(deps, resolveClientId(deps)),
      },
      body: body.toString(),
    },
  });
  return parseTokenResponse(res);
}

/** Exchanges an authorization code (+ PKCE verifier, when the client is public) for CAPI tokens. */
export async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  tokenEndpoint: string;
  deps?: CapiClientDeps;
}): Promise<CapiTokenResponse> {
  const deps = input.deps ?? {};
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: resolveClientId(deps),
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);

  return postToken(
    input.tokenEndpoint,
    body,
    deps,
    'token/authorization_code',
    'capi_token_exchange_upstream',
  );
}

/** Exchanges a refresh token for a fresh CAPI access/ID token pair. */
export async function exchangeRefreshToken(input: {
  refreshToken: string;
  tokenEndpoint: string;
  deps?: CapiClientDeps;
}): Promise<CapiTokenResponse> {
  const deps = input.deps ?? {};
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: resolveClientId(deps),
    refresh_token: input.refreshToken,
  });

  return postToken(
    input.tokenEndpoint,
    body,
    deps,
    'token/refresh_token',
    'capi_token_refresh_upstream',
  );
}
