// ── CAPI: the BFF as an OAuth *client* of Shopify's Customer Account
// API — the mirror image of the IdP section, where Shopify is the
// client of us. Raw redirects, not our {data,meta} envelope, matching how
// authorizeHandler already hands off to a browser mid-flow. ──
// Proves a handoff is being completed by the SAME browser that started the
// login. Both the silent grant and the CAPI claim token used to be bearer-only:
// an attacker could complete a login for their OWN account, then get a victim to
// open the resulting URL, and the victim would end up in the attacker's session
// — everything they typed afterwards accruing to the attacker's account. The
// token alone can't defend against that, because the attacker legitimately holds
// it; only something on the victim's own browser can.
//
// That something is a secret the web app mints into sessionStorage and sends in
// the CLAIM REQUEST BODY. Deliberately not a cookie: it would need
// SameSite=None to survive the cross-origin claim POST, and local/tunnel setups
// drop those, which would make this control untestable in the only environments
// we can exercise it in — and an untestable control is one nobody trusts.
//
// Checking it at the CLAIM step alone covers both attacks: a relayed silent
// grant still has to finish the Shopify round trip and land on web's callback,
// where the victim's sessionStorage holds no matching secret.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  log,
  NotFoundError,
  redis,
  ServiceUnavailableError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from '@devxcommerce/bff-core';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { env } from '../../config/env';
import { parseBody } from '../../lib/parse-body';
import { parseQuery } from '../../lib/parse-query';
import { ok } from '../../lib/response';
import { capiAuthCacheKey, type Customer } from '../../middleware/customer';
import { beginCapiHandshake } from '../../services/capi/handshake';
import { getCapiCustomer } from '../../services/capi/customer';
import { issueCapiSession } from '../../services/capi/session';
import {
  consumeClaimToken,
  createClaimToken,
  deleteCapiSession,
  getCapiSession,
} from '../../services/capi/session_store';
import {
  peekSilentGrant,
  putSilentGrant,
  takePending,
  takeSilentGrant,
} from '../../services/idp/session_store';
import { reportDegradation } from '../../services/upstream-fetch';
import { capiCallbackQuerySchema, capiClaimBodySchema, capiStartQuerySchema } from './schemas';
import {
  missingCapiConfig,
  SILENT_GRANT_COOKIE,
  SILENT_GRANT_COOKIE_MAX_AGE_SECONDS,
} from './shared';
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bindSecretMatches(secret: string, expectedHash: string | undefined): boolean {
  // No hash recorded on the grant/pending state — refuse rather than pass.
  // A missing hash here means either the verify call never sent one (the web
  // client is broken) or this claim is being made against a grant that was
  // never bound to a browser at all — neither is a case to let through.
  if (!expectedHash) return false;
  const a = Buffer.from(sha256Hex(secret), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Shopify ids reach this file in both forms — `gid://shopify/Customer/123` from
// the Customer Account API, and the same value from our own Customer row — so
// compare the numeric tail rather than the raw string. A format difference must
// never read as a different customer: that would refuse a legitimate login.
function sameShopifyCustomer(a: string, b: string): boolean {
  const tail = (id: string) => id.split('/').pop() ?? id;
  const [x, y] = [tail(a), tail(b)];
  return x.length > 0 && x === y;
}

// Only the hosted-checkout host is a legal return_to — never your own site's
// allowlist, since this is the one case where the flow is meant to end on
// Shopify's domain. Exact host match, never a suffix check, so
// `checkout.yourdomain.com.evil.tld` cannot pass. Add your own custom
// checkout domain env var here if you use one distinct from SHOPIFY_STORE_DOMAIN.
function isAllowedReturnTo(candidate: string): boolean {
  const hosts = [env.SHOPIFY_STORE_DOMAIN]
    .filter((h): h is string => !!h)
    .map((h) => h.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  try {
    const u = new URL(candidate);
    return u.protocol === 'https:' && hosts.includes(u.host);
  } catch {
    return false;
  }
}

/** The host of a rejected return_to, for logging — never the whole value, which
 *  is unvalidated caller input and can carry a token or id in its query. */
function returnToHostForLog(candidate: string): string {
  try {
    return new URL(candidate).host;
  } catch {
    return '<unparseable>';
  }
}

// Starts the CAPI handshake, redirecting to Shopify's authorize endpoint.
export async function startCapiAuthorizeHandler(c: Context): Promise<Response> {
  const { grant, return_to: returnToRaw } = parseQuery(c, capiStartQuerySchema);
  // Only meaningful paired with a grant — capiCheckoutGrantHandler's startUrl is
  // the only caller that ever sets both. A stray return_to on an ordinary login
  // call is dropped, same as one that fails the host check below.
  // Dropped rather than refused when it fails the check: the handshake itself is
  // still valid, so the customer completes login and lands on the default page
  // instead of being blocked by a bad parameter.
  const returnTo = grant && returnToRaw && isAllowedReturnTo(returnToRaw) ? returnToRaw : undefined;
  if (returnToRaw && !returnTo) {
    log.warn(
      { returnToHost: returnToHostForLog(returnToRaw) },
      'capi/start ignored a return_to outside the allowed checkout host',
    );
  }
  let grantBindHash: string | undefined;
  // grant is only present on the silent-CAPI-handoff path — this request IS
  // the frontend's real top-level navigation to capiHandoffUrl, so a
  // Set-Cookie on THIS response is first-party and actually sticks (unlike
  // the cross-origin fetch it was previously attempted on). We trust the
  // token itself as the source of truth — it's an unguessable, single-use
  // credential minted only for the customer who just verified OTP, and only
  // this browser ever received it (in its own unique capiHandoffUrl) — so
  // there's no ambient cookie to compare it against here; peekSilentGrant
  // just confirms it hasn't expired or already been consumed before we
  // commit to the Shopify round-trip.
  if (grant) {
    const pendingGrant = await peekSilentGrant(grant);
    grantBindHash = pendingGrant?.bindHash;
    if (!pendingGrant) {
      if (!env.LOGIN_PAGE_URL) {
        throw new ServiceUnavailableError(
          'LOGIN_PAGE_URL is not set — cannot redirect to a login page',
          {
            code: 'idp_login_page_unconfigured',
          },
        );
      }
      return c.redirect(env.LOGIN_PAGE_URL, 302);
    }
    setCookie(c, SILENT_GRANT_COOKIE, grant, {
      httpOnly: true,
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: SILENT_GRANT_COOKIE_MAX_AGE_SECONDS,
    });
  }

  const { CAPI_AUTHORIZE_ENDPOINT, CAPI_REDIRECT_URI, CAPI_SCOPE, CAPI_CLIENT_ID } = env;
  if (missingCapiConfig(CAPI_AUTHORIZE_ENDPOINT, CAPI_REDIRECT_URI, CAPI_SCOPE, CAPI_CLIENT_ID)) {
    throw new ServiceUnavailableError('CAPI authorize flow is not fully configured', {
      code: 'capi_authorize_unconfigured',
    });
  }

  // Single-use, 10-minute TTL (idp/session_store.ts's own PENDING_TTL_SECONDS)
  // — plenty for one redirect round-trip through Shopify's login. Carrying the
  // browser binding from the grant through the Shopify round trip is the single
  // gate covering both the relayed-grant and relayed-claim-token attacks.
  const { authorizeUrl } = await beginCapiHandshake(
    {
      authorizeEndpoint: CAPI_AUTHORIZE_ENDPOINT as string,
      redirectUri: CAPI_REDIRECT_URI as string,
      scope: CAPI_SCOPE as string,
      clientId: CAPI_CLIENT_ID as string,
    },
    { bindHash: grantBindHash, grantToken: grant, returnTo },
  );
  return c.redirect(authorizeUrl, 302);
}

// capi/callback is a TOP-LEVEL navigation, so anything thrown here renders raw
// JSON at the customer — an error page in the middle of logging in. Every failure
// on this route is recoverable by simply logging in again, so send them to the
// login page instead and let them retry. `notice` is a coarse, non-secret reason
// the page can use for a gentle message; it is never the error detail.
//
// Failures are still reported explicitly, because redirecting means the AppError
// handler no longer sees them and would otherwise stop alerting on genuine faults.
function redirectToLoginAfterFailedCallback(
  c: Context,
  notice: 'session-reused' | 'expired' | 'failed',
): Response | null {
  const { LOGIN_PAGE_URL } = env;
  if (!LOGIN_PAGE_URL) return null;
  const url = new URL(LOGIN_PAGE_URL);
  url.searchParams.set('auth_notice', notice);
  return c.redirect(url.toString(), 302);
}

// Completes the CAPI handshake and redirects to the frontend landing page.
export async function capiCallbackHandler(c: Context): Promise<Response> {
  const q = parseQuery(c, capiCallbackQuerySchema);

  // Shopify sends `error` instead of `code` when the customer denies consent
  // or the flow fails on its side — distinct from a malformed callback.
  if (q.error) {
    log.warn({ err: q.error, detail: q.error_description }, 'CAPI authorize denied by Shopify');
    const bounce = redirectToLoginAfterFailedCallback(c, 'failed');
    if (bounce) return bounce;
    throw new ValidationError(q.error_description ?? `Shopify CAPI returned ${q.error}`, {
      code: 'capi_authorize_denied',
    });
  }
  if (!q.code || !q.state) {
    log.warn('CAPI callback hit with no code/state');
    const bounce = redirectToLoginAfterFailedCallback(c, 'failed');
    if (bounce) return bounce;
    throw new ValidationError('Missing code or state', { code: 'capi_callback_invalid_query' });
  }

  const pending = await takePending(q.state);
  if (!pending) {
    // Routine, not a fault: a stale tab, a replayed callback, or a handshake that
    // outlived its 10-minute pending TTL all land here.
    log.warn({ state: q.state }, 'CAPI callback for unknown/expired state');
    const bounce = redirectToLoginAfterFailedCallback(c, 'expired');
    if (bounce) return bounce;
    throw new NotFoundError('Unknown or expired CAPI authorization state', {
      code: 'capi_state_not_found',
    });
  }

  // Our IdP consumes the grant (takeSilentGrant) as the customer is bound, so by
  // now it MUST be gone. Still present means Shopify never called us: it already
  // held a customer-account session and short-circuited /authorize, so `code`
  // below is for whoever that session belongs to rather than for the customer
  // who just passed OTP.
  //
  // That is NOT automatically the wrong customer, and treating it as such was a
  // real bug: signing in from checkout leaves Shopify holding a session for the
  // customer who just logged in, so an immediate second login (browser-back onto
  // our login page, which cannot see that session) short-circuits to the SAME
  // person and was refused anyway. The grant being unconsumed only proves
  // Shopify skipped our IdP — it says nothing about identity, so the identity is
  // compared below, after the exchange, instead of being inferred here.
  let expectedShopifyId: string | undefined;
  if (pending.grantToken) {
    let unconsumed: Awaited<ReturnType<typeof takeSilentGrant>>;
    try {
      // Burns it in the same call — this handshake is over either way, and
      // leaving a live grant behind lets the same round trip be replayed.
      unconsumed = await takeSilentGrant(pending.grantToken);
    } catch (cause) {
      // Redis could not tell us whether our IdP consumed the grant, so there is
      // no way to know whose code this is. Fail closed rather than exchange it:
      // guessing wrong here is the account-takeover this gate exists to stop.
      reportDegradation({
        userImpact: 'Login cannot complete — the customer is returned to the login page to retry.',
        impact: 'blocking',
        at: 'routes/capi_handlers.ts:capiCallbackHandler',
        code: 'capi_grant_lookup_failed',
        cause,
      });
      const bounce = redirectToLoginAfterFailedCallback(c, 'failed');
      if (bounce) return bounce;
      throw new ServiceUnavailableError('Could not verify the sign-in grant', {
        code: 'capi_grant_lookup_failed',
        cause,
      });
    }
    if (unconsumed) {
      expectedShopifyId = unconsumed.shopifyId;
      log.warn(
        { state: q.state },
        'CAPI callback: Shopify reused an existing customer-account session instead of authenticating via our IdP — verifying the returned identity before issuing a session',
      );
    }
  }

  // The app's checkout warm-up: this browser already belongs to a signed-in
  // customer and only came through here so Shopify would set its own cookie in
  // this cookie jar. There is no session to issue — minting one would leave a
  // spare session record nobody redeems — so the code is simply abandoned (it
  // expires on Shopify's side) and the browser goes on to checkout.
  //
  // The identity gate still applies, and matters more here than on the normal
  // path: a short-circuited /authorize means the cookie now in this jar belongs
  // to whoever Shopify already had, which may not be your customer. Without the
  // exchange there is no way to check who that is, so this fails closed.
  //
  // Also requires grantToken: this is the warm-up path's own marker (only
  // capiCheckoutGrantHandler's startUrl sets both together), so a stray
  // return_to on an ordinary login call can't skip session issuance.
  if (pending.returnTo && pending.grantToken) {
    if (expectedShopifyId) {
      log.warn(
        { state: q.state },
        'CAPI checkout warm-up refused: Shopify reused an existing session, so the identity behind the planted cookie is unproven',
      );
      const bounce = redirectToLoginAfterFailedCallback(c, 'session-reused');
      if (bounce) return bounce;
      throw new UnauthorizedError('Could not confirm who this checkout session belongs to', {
        code: 'capi_warmup_session_reused',
      });
    }
    return c.redirect(pending.returnTo, 302);
  }

  const { CAPI_TOKEN_ENDPOINT, CAPI_CALLBACK_LANDING_URL } = env;
  if (missingCapiConfig(CAPI_TOKEN_ENDPOINT, CAPI_CALLBACK_LANDING_URL)) {
    // A real misconfiguration — reported so it still alerts, since redirecting
    // means the AppError handler never sees it.
    reportDegradation({
      userImpact: 'Login cannot complete — the customer is returned to the login page.',
      impact: 'blocking',
      at: 'routes/capi_handlers.ts:capiCallbackHandler',
      code: 'capi_callback_unconfigured',
      cause: new Error('CAPI_TOKEN_ENDPOINT or CAPI_CALLBACK_LANDING_URL unset'),
    });
    const bounce = redirectToLoginAfterFailedCallback(c, 'failed');
    if (bounce) return bounce;
    throw new ServiceUnavailableError('CAPI callback is not fully configured', {
      code: 'capi_callback_unconfigured',
    });
  }

  let sessionId: string;
  try {
    sessionId = await issueCapiSession({
      code: q.code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier,
      tokenEndpoint: CAPI_TOKEN_ENDPOINT as string,
    });
  } catch (e) {
    // A genuine upstream failure — reported so it still alerts, since the customer
    // is redirected rather than shown the error.
    reportDegradation({
      userImpact: 'Login could not complete — the customer is returned to the login page to retry.',
      impact: 'blocking',
      at: 'routes/capi_handlers.ts:capiCallbackHandler',
      code: 'capi_session_issue_failed',
      cause: e,
    });
    const bounce = redirectToLoginAfterFailedCallback(c, 'failed');
    if (bounce) return bounce;
    // issueCapiSession's own missing-refresh-token guard is a plain Error
    // (it had no request boundary to map to when it was written) — this IS
    // that boundary now, so wrap anything not already an AppError.
    if (e instanceof AppError) throw e;
    throw new UpstreamError('CAPI authorization code exchange failed', {
      code: 'capi_session_issue_failed',
      cause: e,
    });
  }

  // Shopify short-circuited /authorize (the grant above survived), so the
  // session just minted is for whoever Shopify already had. Confirm that is the
  // same customer who passed OTP before handing it over; a mismatch is the
  // account-takeover case this gate exists for, so the session is destroyed
  // rather than left redeemable indefinitely.
  if (expectedShopifyId) {
    let actualShopifyId: string | null = null;
    let idToken: string | undefined;
    try {
      const record = await getCapiSession(sessionId);
      idToken = record?.idToken;
      actualShopifyId = record
        ? ((await getCapiCustomer(record.accessToken))?.shopifyId ?? null)
        : null;
    } catch (cause) {
      // Could not prove identity either way — fail closed, same as a mismatch.
      log.warn({ err: cause, state: q.state }, 'CAPI identity check failed; refusing the session');
    }
    if (!actualShopifyId || !sameShopifyCustomer(actualShopifyId, expectedShopifyId)) {
      await deleteCapiSession(sessionId).catch((cause) => {
        reportDegradation({
          userImpact: 'None visible — the refused login is rejected either way.',
          impact: 'blocking',
          at: 'routes/capi_handlers.ts:capiCallbackHandler',
          code: 'capi_refused_session_cleanup_failed',
          cause,
        });
      });
      log.warn(
        { state: q.state },
        'CAPI callback refused: Shopify returned a different customer than the one just verified',
      );

      // Refusing alone would dead-end them: Shopify still holds the OTHER
      // customer's session, so every retry short-circuits to the same wrong
      // identity until that session expires on its own. The exchange above is
      // what makes recovery possible — it handed us that session's own id_token,
      // which end_session_endpoint requires as id_token_hint (it rejects a
      // request without one). Send them through Shopify's logout so its session
      // is gone, and Shopify returns them to the login page for a clean retry.
      const logoutUrl = buildShopifyLogoutUrl(idToken);
      if (logoutUrl) return c.redirect(logoutUrl, 302);
      // No end_session_endpoint configured (uat/prod today) — still never show an
      // error page; the retry just cannot be made clean from here.
      const bounce = redirectToLoginAfterFailedCallback(c, 'session-reused');
      if (bounce) return bounce;
      throw new UnauthorizedError(
        'Shopify returned a different customer than the one just verified — sign out of Shopify and try again',
        { code: 'capi_session_reused' },
      );
    }
  }

  // The real session id is a long-lived bearer credential — never put it in a
  // URL (browser history, access logs, Referer leakage). Redirect with a
  // short-lived, single-use claim token instead; the frontend trades it for
  // the real id via capiClaimSessionHandler below, in a JSON body, not a URL.
  const claimToken = await createClaimToken(sessionId, pending.bindHash);
  const landing = new URL(CAPI_CALLBACK_LANDING_URL as string);
  landing.searchParams.set('capi_claim', claimToken);
  return c.redirect(landing.toString(), 302);
}

// Revokes the caller's own CAPI session server-side on logout. Without this,
// clearing the client store only drops the local copy: the Redis record — which
// wraps live Shopify access + refresh tokens — stayed redeemable for its full
// indefinitely, so a leaked id outlives the logout meant to kill it — which
// matters more now the session has no TTL to eventually clean up after a miss.
// Idempotent, and 200 even when Redis is unreachable: a logout must never fail
// in a way that leaves the client unable to finish clearing its own state. The
// swallow is reported rather than hidden, since a session that outlives its
// logout is exactly what this endpoint exists to prevent.
/**
 * Shopify's RP-initiated-logout URL for this session, or null when unconfigured
 * or when there's no id_token to send. Confirmed against Shopify directly
 * (verified against Shopify directly): end_session_endpoint REJECTS a request with no
 * id_token_hint ("Invalid id_token") rather than logging out anonymously, so a
 * URL built without one wouldn't just skip the clean return trip — Shopify's
 * session would survive untouched, silently defeating the caller.
 */
function buildShopifyLogoutUrl(idToken: string | undefined): string | null {
  const { CAPI_END_SESSION_ENDPOINT, CAPI_POST_LOGOUT_REDIRECT_URI } = env;
  if (!CAPI_END_SESSION_ENDPOINT || !CAPI_POST_LOGOUT_REDIRECT_URI || !idToken) {
    return null;
  }

  const url = new URL(CAPI_END_SESSION_ENDPOINT);
  url.searchParams.set('post_logout_redirect_uri', CAPI_POST_LOGOUT_REDIRECT_URI);
  url.searchParams.set('id_token_hint', idToken);
  return url.toString();
}

export async function capiLogoutHandler(c: Context): Promise<Response> {
  const header = c.req.header('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // Ignore any other bearer shape on the same header (e.g. a Shopify Storefront
  // customerAccessToken) — only our own opaque session ids are ours to delete.
  let logoutUrl: string | null = null;
  if (bearer.startsWith('capi_sess_')) {
    try {
      // Read the id_token BEFORE deleting the record — it is the only proof of
      // which Shopify session this was, and Shopify REQUIRES it as
      // id_token_hint to end that session (a request without one is rejected
      // outright, see buildShopifyLogoutUrl). A missing record — Shopify's
      // session outliving ours because ours expired or was revoked
      // server-side — means there's no id_token left to send, so this
      // returns null rather than a URL Shopify would just reject.
      const record = await getCapiSession(bearer);
      logoutUrl = buildShopifyLogoutUrl(record?.idToken);
      await deleteCapiSession(bearer);
      // middleware/customer.ts caches the resolved customer per session id for
      // 60s; without dropping that key too, requireCustomer keeps admitting the
      // revoked id for up to a minute after this returns.
      await redis().del(capiAuthCacheKey(bearer));
    } catch (cause) {
      reportDegradation({
        userImpact:
          'None visible — the client logs out, but the server-side session stays redeemable until its TTL.',
        impact: 'blocking',
        at: 'routes/capi_handlers.ts:capiLogoutHandler',
        code: 'capi_session_revoke_failed',
        cause,
      });
    }
  }
  return ok(c, { revoked: true, logoutUrl });
}

// Trades a one-time claim token (from the callback redirect) for the real
// CAPI session id, in a JSON body — the only place the real id is ever
// transmitted to the frontend.
export async function capiClaimSessionHandler(c: Context): Promise<Response> {
  const body = await parseBody(c, capiClaimBodySchema);
  const claimed = await consumeClaimToken(body.claimToken);
  if (!claimed) {
    throw new NotFoundError('Unknown or expired CAPI claim token', {
      code: 'capi_claim_not_found',
    });
  }
  // Bound to the browser that completed the CAPI flow. Without this, a single
  // relayed URL put a victim into the attacker's long-lived session — and the web
  // callback clears any v1 credential first, so the attacker's won outright.
  if (!bindSecretMatches(body.bindSecret, claimed.bindHash)) {
    throw new UnauthorizedError('This sign-in link was not issued to this browser', {
      code: 'capi_claim_not_bound',
    });
  }
  return ok(c, { sessionId: claimed.sessionId });
}

// ── Mobile-app checkout warm-up. Everything below is app-only: the web flow
// never calls this route. The app walks /capi/start → /capi/callback →
// /capi/claim itself with its own HTTP client for LOGIN — this handler only
// covers a checkout webview warming up Shopify's own cookie, not login. ──

// Mints a fresh single-use grant for a customer who is ALREADY signed in, so the
// app can warm Shopify's cookie inside the webview it is about to open checkout
// in. Gated on a live session, so it hands out nothing the caller could not
// already do — it only lets them do it in a different cookie jar.
export async function capiCheckoutGrantHandler(c: Context): Promise<Response> {
  const customer = c.get('customer') as Customer;
  const grant = `idp_silent_${randomUUID()}`;
  await putSilentGrant(grant, {
    shopifyId: customer.shopifyId,
    // Always a real address: the signup gate refuses to issue a session to a
    // customer without one, so there is nothing to fall back to here.
    email: customer.email,
  });

  // Assembled here rather than in the app so the caller never has to know the
  // BFF's own origin, and so the start route's allowlist stays a server-side
  // concern. Unset would yield a relative startUrl the app cannot open, so
  // refuse before the grant is minted rather than hand back something unusable.
  if (!env.CAPI_REDIRECT_URI) {
    throw new ServiceUnavailableError('The mobile checkout warm-up is not configured', {
      code: 'capi_checkout_grant_unconfigured',
    });
  }
  const base = new URL(env.CAPI_REDIRECT_URI).origin;
  return ok(c, {
    grant,
    startUrl: `${base}/auth/capi/start?grant=${encodeURIComponent(grant)}`,
  });
}
