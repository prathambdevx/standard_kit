// ── IdP: raw OIDC/OAuth2 JSON per spec, NOT our {data,meta} envelope — Shopify
// (the relying party) is a standard OAuth client expecting the wire protocol's
// own shapes at these specific endpoints. ──
import { log, ServiceUnavailableError, UnauthorizedError } from '@devxcommerce/bff-core';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '../../config/env';
import { parseQuery } from '../../lib/parse-query';
import {
  allowedRedirectUris,
  authenticateClient,
  completeInteraction,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getDiscoveryDocument,
  getJwks,
  getUserinfo,
  isAllowedPostLogoutRedirectUri,
  startAuthorize,
} from '../../services/idp/provider';
import { takeSilentGrant } from '../../services/idp/session_store';
import { setLoginTraceId } from './login_trace';
import { idpAuthorizeQuerySchema, idpLogoutQuerySchema, idpTokenBodySchema } from './schemas';
import { INTERACTION_COOKIE, issuer, SILENT_GRANT_COOKIE } from './shared';

export function discoveryHandler(c: Context): Response {
  return c.json(getDiscoveryDocument(issuer(c)));
}

export async function jwksHandler(c: Context): Promise<Response> {
  return c.json(await getJwks());
}

// Starts the interaction, stores its id in an httpOnly cookie, and redirects
// the browser to our own login page — the OTP endpoints above read this
// cookie to auto-complete the interaction once verification succeeds.
export async function authorizeHandler(c: Context): Promise<Response> {
  const q = parseQuery(c, idpAuthorizeQuerySchema);
  const result = await startAuthorize({
    clientId: q.client_id ?? '',
    redirectUri: q.redirect_uri,
    responseType: q.response_type,
    state: q.state,
    nonce: q.nonce,
    scope: q.scope,
    codeChallenge: q.code_challenge,
    codeChallengeMethod: q.code_challenge_method,
  });
  if (!result.ok) {
    // Shopify refused at the very first hop; a bare OAuth 400 leaves no other trace.
    log.warn(
      { error: result.error, clientId: q.client_id, redirectUri: q.redirect_uri },
      'idp/authorize refused the request',
    );
    return c.json({ error: result.error }, 400);
  }

  // This browser may have just verified OTP on our own site and be mid
  // silent-CAPI-handoff (respondWithSilentCapiHandoff / startCapiAuthorizeHandler)
  // — auto-complete instead of a second OTP prompt. A real Path B hit never
  // has this cookie. idp_silent_grant is ambient across tabs on this browser,
  // so a second Path-A login started between startCapiAuthorizeHandler
  // setting it and this handler reading it (i.e. during the Shopify
  // round-trip) could still overwrite it — same class of accepted,
  // narrow-window limit as MAX_INTERACTION_TO_OTP_SEND_GAP_MS in otp_handlers.ts, not
  // solvable by cookie alone; single-use (takeSilentGrant) at least bounds
  // the damage to one hijacked completion, not a persistent one.
  const silentGrantToken = getCookie(c, SILENT_GRANT_COOKIE);
  if (silentGrantToken) {
    const grant = await takeSilentGrant(silentGrantToken);
    deleteCookie(c, SILENT_GRANT_COOKIE, { path: '/' });
    if (grant) {
      setLoginTraceId(c, grant.loginTraceId);
      const completed = await completeInteraction(result.interaction.id, grant, grant.loginTraceId);
      if (completed.ok) return c.redirect(completed.redirectUrl, 302);
      // Fell through (interaction TTL race, practically impossible right
      // after startAuthorize just created it) — don't leave the browser
      // stuck, drop to the normal login-page prompt below.
      log.warn(
        { loginTraceId: grant.loginTraceId, interactionId: result.interaction.id },
        'idp/authorize: silent grant was consumed but the interaction could not be completed: falling back to the login page',
      );
    } else {
      // Cookie present but the grant is spent or past its TTL; no grant means no trace id.
      log.warn(
        { clientId: q.client_id },
        'idp/authorize: silent-grant cookie present but the grant was already consumed or expired: falling back to the login page',
      );
    }
  } else if (q.prompt !== 'none') {
    // No cookie is ambiguous by design (a checkout-initiated login arrives this way), so info.
    log.info(
      { clientId: q.client_id },
      'idp/authorize: no silent-grant cookie on the request: treating this as an interactive login',
    );
  }

  // prompt=none (OIDC §3.1.2.6) forbids any UI — checkout's sso=silent sends
  // this, and answering with our login page rendered OTP inside checkout.
  if (q.prompt === 'none' && q.redirect_uri) {
    const target = new URL(q.redirect_uri);
    target.searchParams.set('error', 'login_required');
    if (q.state) target.searchParams.set('state', q.state);
    log.info({ redirectUri: q.redirect_uri }, 'idp: prompt=none with no session — login_required');
    return c.redirect(target.toString(), 302);
  }

  if (!env.LOGIN_PAGE_URL) {
    throw new ServiceUnavailableError(
      'LOGIN_PAGE_URL is not set — cannot redirect to a login page',
      {
        code: 'idp_login_page_unconfigured',
      },
    );
  }
  // web's origin and the BFF's origin are always different subdomains in
  // every real deployment, so the /otp/verify call that reads this cookie
  // back is cross-origin — SameSite=Lax drops it there (Lax only rides
  // along on top-level navigations, not fetch/XHR). None+Secure is required
  // for that, but Secure needs HTTPS, which plain local dev doesn't have —
  // same NODE_ENV==='production' split db/client.ts uses for its SSL flag.
  setCookie(c, INTERACTION_COOKIE, result.interaction.id, {
    httpOnly: true,
    sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return c.redirect(env.LOGIN_PAGE_URL, 302);
}

// Shopify's server is the only caller and these replies are raw OAuth JSON that never
// reaches the AppError handler, so a refusal logs nothing unless it logs itself.
function refuseToken(
  c: Context,
  error: string,
  status: 400 | 401,
  fields: Record<string, unknown> = {},
): Response {
  log.warn({ error, ...fields }, `idp/token refused: ${error}`);
  return c.json({ error }, status);
}

export async function tokenHandler(c: Context): Promise<Response> {
  const raw = new URLSearchParams(await c.req.text());
  const parsed = idpTokenBodySchema.safeParse(Object.fromEntries(raw.entries()));
  if (!parsed.success) {
    return refuseToken(c, 'invalid_request', 400, { reason: 'body_failed_schema' });
  }
  const body = parsed.data;

  if (
    !authenticateClient({
      basicAuthHeader: c.req.header('authorization'),
      bodyClientId: body.client_id,
      bodyClientSecret: body.client_secret,
    })
  ) {
    // Credential drift between us and Shopify would otherwise break every login silently.
    return refuseToken(c, 'invalid_client', 401, {
      viaBasicAuth: !!c.req.header('authorization'),
    });
  }

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri) {
      return refuseToken(c, 'invalid_request', 400, {
        reason: 'missing_code_or_redirect_uri',
        hasCode: !!body.code,
        hasRedirectUri: !!body.redirect_uri,
      });
    }
    const result = await exchangeAuthorizationCode({
      code: body.code,
      redirectUri: body.redirect_uri,
      codeVerifier: body.code_verifier,
      issuer: issuer(c),
    });
    // exchangeAuthorizationCode logs which of the three refusals it was.
    if (!result.ok) return refuseToken(c, result.error, 400, { grantType: 'authorization_code' });
    setLoginTraceId(c, result.loginTraceId);
    return c.json(result.tokens);
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return refuseToken(c, 'invalid_request', 400, { reason: 'missing_refresh_token' });
    }
    const result = await exchangeRefreshToken({
      refreshToken: body.refresh_token,
      issuer: issuer(c),
    });
    if (!result.ok) return refuseToken(c, result.error, 400, { grantType: 'refresh_token' });
    return c.json(result.tokens);
  }

  return refuseToken(c, 'unsupported_grant_type', 400, { grantType: body.grant_type });
}

export async function userinfoHandler(c: Context): Promise<Response> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const info = await getUserinfo(token, issuer(c));
  if (!info) {
    log.warn({ hadBearer: !!token }, 'idp/userinfo refused: token did not verify');
    throw new UnauthorizedError('Invalid token', { code: 'idp_invalid_token' });
  }
  return c.json(info);
}

export function logoutHandler(c: Context): Response {
  const q = parseQuery(c, idpLogoutQuerySchema);
  // Exact-match allowlist plus any trusted Shopify origin — see isAllowedPostLogoutRedirectUri.
  if (isAllowedPostLogoutRedirectUri(q.post_logout_redirect_uri)) {
    return c.redirect(q.post_logout_redirect_uri as string, 302);
  }
  // Logged so a legitimate-but-unlisted callback (indistinguishable from an
  // attack here) can be diagnosed instead of silently stranding the shopper.
  if (q.post_logout_redirect_uri) {
    log.warn(
      { postLogoutRedirectUri: q.post_logout_redirect_uri, allowed: allowedRedirectUris() },
      'idp/logout refused a post_logout_redirect_uri that is neither allowlisted nor Shopify-origin',
    );
  }
  // No usable redirect target from the caller — send them to our login page
  // instead of the bare text below (checkout's own logout hits this).
  if (env.LOGIN_PAGE_URL) {
    return c.redirect(env.LOGIN_PAGE_URL, 302);
  }
  return c.text('Logged out', 200);
}
