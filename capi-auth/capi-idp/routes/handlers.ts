import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  NotFoundError,
  redis,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from '@devxcommerce/bff-core';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '../../config/env';
import { parseBody } from '../../lib/parse-body';
import { parseQuery } from '../../lib/parse-query';
import { ok } from '../../lib/response';
import { capiAuthCacheKey } from '../../middleware/customer';
import { createCustomerFromSignup } from '../../repositories/customer_signup';
import { findOrLazyFillByEmail, findOrLazyFillByPhone } from '../../repositories/customers';
import { getInteraction } from '../../repositories/idp_interactions';
import { getChallenge, takeChallenge } from '../../repositories/otp_challenges';
import { issueCapiSession } from '../../services/capi/session';
import {
  consumeClaimToken,
  createClaimToken,
  deleteCapiSession,
} from '../../services/capi/session_store';
import {
  authenticateClient,
  completeInteraction,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getDiscoveryDocument,
  getJwks,
  getUserinfo,
  isAllowedRedirectUri,
  startAuthorize,
} from '../../services/idp/provider';
import {
  peekSilentGrant,
  putPending,
  putSilentGrant,
  takePending,
  takeSilentGrant,
} from '../../services/idp/session_store';
import { createOtp, resendOtp, verifyOtp } from '../../services/otp_engine/provider';
import {
  checkOtpSendRateLimit,
  checkOtpVerifyRateLimit,
} from '../../services/otp_engine/rate_limit';
import { createShopifyCustomer } from '../../services/shopify/admin/customer-create';
import { isSyntheticEmail } from '../../services/shopify/admin/synthetic-email';
import { reportDegradation } from '../../services/upstream-fetch';
import {
  capiCallbackQuerySchema,
  capiClaimBodySchema,
  capiStartQuerySchema,
  idpAuthorizeQuerySchema,
  idpLogoutQuerySchema,
  idpTokenBodySchema,
  otpDetailsSchema,
  otpResendSchema,
  otpSendSchema,
  otpVerifySchema,
} from './schemas';

const INTERACTION_COOKIE = 'idp_interaction';
// Carries the silent-CAPI-handoff grant (see respondWithCustomerSession /
// authorizeHandler below) — a completely separate concern from
// INTERACTION_COOKIE even though both are short-lived httpOnly cookies on
// this same /idp/authorize endpoint.
const SILENT_GRANT_COOKIE = 'idp_silent_grant';
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
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bindSecretMatches(secret: string | undefined, expectedHash: string | undefined): boolean {
  // No hash stored: a login started before this shipped, or a caller that never
  // sent one. Nothing to compare against, so it passes — tightening this to a
  // hard requirement is safe once no pre-existing claim tokens can be in flight
  // (they live 60s), and is the follow-up to make it mandatory.
  if (!expectedHash) return true;
  if (!secret) return false;
  const a = Buffer.from(sha256Hex(secret), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bffBaseUrl(c: Context): string {
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'localhost';
  return `${proto}://${host}`;
}

function issuer(c: Context): string {
  return `${bffBaseUrl(c)}/auth/idp`;
}

// RIGHTMOST x-forwarded-for entry, not the leftmost. The ALB APPENDS the address
// it received the connection from, so the last entry is the only one a caller
// cannot forge — everything to its left is client-supplied. Reading the leftmost
// let anyone mint a fresh per-IP rate-limit bucket per request by sending their
// own header, which is the only cap standing between a caller and unbounded SMS
// spend across many different phone numbers.
//
// Deliberately NOT shared with modules/glood/handlers.ts's shopperIp: that one
// feeds a recommendation vendor, where a spoofed value costs nothing. This one
// is a security control.
function clientIp(c: Context): string {
  const parts = c.req.header('x-forwarded-for')?.split(',') ?? [];
  const last = parts.at(-1)?.trim();
  return last && /^[0-9a-f.:]+$/i.test(last) ? last : 'unknown';
}

// ── OTP: our own API, follows the standard {data,meta}/{error,meta} envelope ──

// Sends an OTP to the customer's phone or email, depending on channel.
export async function sendOtpHandler(c: Context): Promise<Response> {
  const body = await parseBody(c, otpSendSchema);
  // A synthetic address is a placeholder we minted for a phone-only signup, not
  // an inbox — it is non-deliverable, so an OTP sent there could never arrive,
  // and accepting it would let someone claim an account by typing a value
  // derivable from a phone number alone. Phone OTP is that customer's route in.
  // Deliberately the same message and code as the schema's own email refine, so
  // this is indistinguishable from a malformed address: a synthetic value is
  // derivable from a phone number alone, so any hint that one maps to a real
  // account would turn this endpoint into a phone-number enumeration oracle.
  if (body.channel === 'email' && isSyntheticEmail(body.username)) {
    throw new ValidationError('Email OTP requires a valid email address', {
      code: 'invalid_payload',
    });
  }
  await checkOtpSendRateLimit(body.username, clientIp(c));
  const { otpId } = await createOtp(body.username, body.channel);
  return ok(c, { otpId });
}

// Re-sends an OTP for an in-flight challenge, subject to the resend cooldown
// and the same per-phone/IP send caps as the initial send.
export async function resendOtpHandler(c: Context): Promise<Response> {
  const body = await parseBody(c, otpResendSchema);
  const result = await resendOtp(body.otpId, clientIp(c));
  if ('error' in result) throw otpErrorToAppError(result.error);
  return ok(c, { otpId: result.otpId });
}

// Verifies the code, resolves/lazily-fills the local Customer row. Three
// outcomes: no Shopify customer for this identity at all → details_required
// (a genuinely new signup); otherwise, if a pending IdP interaction cookie is
// present, completes it and returns the Shopify redirect; otherwise just
// confirms the identity is verified (no IdP interaction; e.g. a standalone
// OTP check).
export async function verifyOtpHandler(c: Context): Promise<Response> {
  const body = await parseBody(c, otpVerifySchema);
  // Caps guesses per network. claimAttempt caps them per challenge, which an
  // attacker sidesteps by requesting a fresh challenge for each new budget.
  await checkOtpVerifyRateLimit(clientIp(c));
  // Fetched before verifyOtp for its createdAt (the ORIGINAL send time,
  // per services/otp_engine/index.ts — resend never touches it) — respondWithCustomerSession
  // uses this to tell a genuinely-pending IdP interaction from a stale one.
  const challenge = await getChallenge(body.otpId);
  const result = await verifyOtp(body.otpId, body.code);
  if (!result.ok) throw otpErrorToAppError(result.error);

  // Branch on the verified channel: the phone lookup queries Shopify with
  // phone:"<value>", which can never match an address, so routing an email
  // login through it pushed every existing email customer into signup — where
  // Shopify then rejected the duplicate address as a 502.
  const customer =
    result.channel === 'email'
      ? await findOrLazyFillByEmail(result.username)
      : await findOrLazyFillByPhone(result.username);
  if (!customer) {
    // Shopify has never seen this phone/address — nothing to prefill from. On
    // the email channel
    // the address is already proven, so prefill it and drop the requirement
    // rather than asking again for what was just verified (the submit handler
    // binds the verified value regardless of what the client sends).
    const verifiedEmail = result.channel === 'email' ? result.username : null;
    return ok(c, {
      status: 'details_required' as const,
      otpId: body.otpId,
      emailRequired: !verifiedEmail,
      prefill: { firstName: null, lastName: null, email: verifiedEmail },
    });
  }
  return respondWithCustomerSession(c, customer, challenge?.createdAt ?? null);
}

// Same duration as OTP_TTL_MS in services/otp_engine/index.ts, but counted from when
// the challenge was CONSUMED (its updatedAt, bumped by markConsumed), not the
// original send. Defense in depth alongside takeChallenge's atomic claim below —
// this window is what closes the gap between "signup succeeded" and "the
// delete actually landed" (or failed and was degraded), not the only guard.
const DETAILS_SUBMISSION_WINDOW_MS = 5 * 60 * 1000;

// Collects details for a phone-verified signup with no Shopify customer yet
// (the details_required branch above), creates the Shopify + local Customer
// rows, then completes any pending IdP interaction exactly like an existing
// customer's verify — same response shape either way.
export async function submitOtpDetailsHandler(c: Context): Promise<Response> {
  const body = await parseBody(c, otpDetailsSchema);
  const challenge = await getChallenge(body.otpId);
  if (!challenge?.consumed) {
    throw new NotFoundError('OTP was not verified for this id', { code: 'otp_not_verified' });
  }
  if (Date.now() - challenge.updatedAt.getTime() > DETAILS_SUBMISSION_WINDOW_MS) {
    throw new ValidationError('Signup window expired — verify again', {
      code: 'otp_details_expired',
    });
  }

  // The challenge's username IS the phone for the mobile channel — never
  // asked for again on this endpoint. Email-channel signups may type a phone
  // in the body instead; it's saved as-is, same trust level as `email` below
  // (see otpDetailsSchema's phone field comment — a deliberate product
  // decision, not an oversight; document it as an accepted tradeoff in your
  // own security notes if you keep this shape).
  const phone = challenge.channel === 'mobile' ? challenge.username : body.phone;
  // An email-channel challenge already PROVED an address, so that one is
  // authoritative and body.email is ignored. Taking the client's value here
  // would let someone verify attacker@x.com and register victim@y.com — an
  // account on an address they never proved, squatting the victim's future
  // email login. Only the mobile channel has no verified address to bind.
  const email = challenge.channel === 'email' ? challenge.username : body.email;
  // Only reachable on the mobile channel, where verify returned emailRequired:true
  // — a 400 rather than a crash if a client ignores that flag.
  if (!email) {
    throw new ValidationError('An e-mail address is required to finish signup', {
      code: 'otp_details_email_missing',
    });
  }
  // Claim the challenge BEFORE calling Shopify, not after: a delete placed at
  // the end of the flow is cleanup, not a lock — two concurrent submits (a
  // double-tap on a flaky connection is enough, no attacker required) could
  // both pass the checks above and both reach createShopifyCustomer, and
  // Shopify's own email uniqueness is not a documented guarantee under
  // concurrency. The atomic delete-by-id here means only one ever proceeds;
  // the loser gets a clean 404 rather than racing an external API.
  const claimed = await takeChallenge(body.otpId);
  if (!claimed) {
    throw new NotFoundError('OTP was not verified for this id', { code: 'otp_not_verified' });
  }
  const shopifyCustomer = await createShopifyCustomer({
    phone,
    email,
    firstName: body.firstName,
    lastName: body.lastName,
    acceptEmailMarketing: body.acceptEmailMarketing,
    acceptSmsMarketing: body.acceptSmsMarketing,
  });
  const customer = await createCustomerFromSignup({
    shopifyId: shopifyCustomer.id,
    name: `${body.firstName} ${body.lastName}`.trim(),
    email: shopifyCustomer.email ?? email,
    phone: phone ?? null,
  });
  return respondWithCustomerSession(c, customer, challenge.createdAt);
}

// Max gap between the /authorize hit and the OTP send it's for (Bug 22a #2) — a known, accepted limit, not solvable by cookie+timing alone.
const MAX_INTERACTION_TO_OTP_SEND_GAP_MS = 30 * 1000;

function interactionMatchesThisLogin(
  interactionCreatedAt: Date,
  otpChallengeCreatedAt: Date | null,
): boolean {
  if (!otpChallengeCreatedAt) return false;
  const gap = otpChallengeCreatedAt.getTime() - interactionCreatedAt.getTime();
  return gap >= 0 && gap <= MAX_INTERACTION_TO_OTP_SEND_GAP_MS;
}

// Completes a genuine pending interaction (Path B), else falls to a silent CAPI handoff (Path A).
async function respondWithCustomerSession(
  c: Context,
  customer: { shopifyId: string | null; email: string },
  otpChallengeCreatedAt: Date | null,
): Promise<Response> {
  if (!customer.shopifyId) {
    throw new NotFoundError('No Shopify customer for this phone', { code: 'customer_not_found' });
  }
  const shopifyCustomer = { shopifyId: customer.shopifyId, email: customer.email };

  const interactionId = getCookie(c, INTERACTION_COOKIE);
  if (interactionId) {
    const interaction = await getInteraction(interactionId);
    if (interaction && !interactionMatchesThisLogin(interaction.createdAt, otpChallengeCreatedAt)) {
      // Stale/orphaned — don't touch the row (it may still be legitimately
      // in flight for whichever browser it actually belongs to; it'll simply
      // TTL out on its own), just stop treating THIS login as Path B.
      deleteCookie(c, INTERACTION_COOKIE, { path: '/' });
    } else {
      const completed = await completeInteraction(interactionId, shopifyCustomer);
      deleteCookie(c, INTERACTION_COOKIE, { path: '/' });
      if (!completed.ok) {
        throw new NotFoundError('Login session expired', { code: 'idp_interaction_expired' });
      }
      return ok(c, { status: 'authenticated' as const, redirectUrl: completed.redirectUrl });
    }
  }

  return respondWithSilentCapiHandoff(c, shopifyCustomer);
}

// Must match session_store.ts's own SILENT_GRANT_TTL_SECONDS.
const SILENT_GRANT_COOKIE_MAX_AGE_SECONDS = 5 * 60;

// Path A: stashes a single-use grant and hands back a URL that kicks off the
// CAPI dance. Does NOT set idp_silent_grant here — this response is to a
// cross-origin fetch() (web app's origin -> BFF's origin), and browsers won't
// reliably persist a Set-Cookie from that kind of request even with
// SameSite=None;Secure (Chrome's third-party-cookie blocking applies to the
// SETTING request itself, not just later sending). The cookie is set instead
// in startCapiAuthorizeHandler below, on the response to the real top-level
// navigation the frontend does to capiHandoffUrl.
async function respondWithSilentCapiHandoff(
  c: Context,
  customer: { shopifyId: string; email: string },
): Promise<Response> {
  const {
    CAPI_AUTHORIZE_ENDPOINT,
    CAPI_REDIRECT_URI,
    CAPI_SCOPE,
    CAPI_CLIENT_ID,
  } = env;
  if (
    missingCapiConfig(
      CAPI_AUTHORIZE_ENDPOINT,
      CAPI_REDIRECT_URI,
      CAPI_SCOPE,
      CAPI_CLIENT_ID,
    )
  ) {
    // CAPI isn't wired up in this environment yet — the old, plain outcome
    // (verified on our own site, no Shopify session) rather than a handoff
    // URL that would 502.
    return ok(c, { status: 'verified' as const });
  }

  const token = `idp_silent_${randomUUID()}`;
  await putSilentGrant(token, {
    ...customer,
    bindHash: c.req.header('x-bsc-bind-hash') ?? undefined,
  });

  return ok(c, {
    status: 'verified' as const,
    capiHandoffUrl: `${bffBaseUrl(c)}/auth/capi/start?grant=${encodeURIComponent(token)}`,
  });
}

function otpErrorToAppError(error: string): Error {
  switch (error) {
    case 'otp_locked':
      return new TooManyRequestsError('Too many attempts', { code: 'otp_locked' });
    case 'otp_expired':
      return new ValidationError('OTP expired', { code: 'otp_expired' });
    case 'otp_incorrect':
      return new ValidationError('Incorrect OTP', { code: 'otp_incorrect' });
    case 'otp_cooldown':
      return new TooManyRequestsError('Resend cooldown active', { code: 'otp_cooldown' });
    default:
      return new NotFoundError('OTP session not found', { code: 'otp_not_found' });
  }
}

// ── IdP: raw OIDC/OAuth2 JSON per spec, NOT our {data,meta} envelope — Shopify
// (the relying party) is a standard OAuth client expecting the wire protocol's
// own shapes at these specific endpoints. ──

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
  if (!result.ok) return c.json({ error: result.error }, 400);

  // This browser may have just verified OTP on our own site and be mid
  // silent-CAPI-handoff (respondWithSilentCapiHandoff / startCapiAuthorizeHandler)
  // — auto-complete instead of a second OTP prompt. A real Path B hit never
  // has this cookie. idp_silent_grant is ambient across tabs on this browser,
  // so a second Path-A login started between startCapiAuthorizeHandler
  // setting it and this handler reading it (i.e. during the Shopify
  // round-trip) could still overwrite it — same class of accepted,
  // narrow-window limit as MAX_INTERACTION_TO_OTP_SEND_GAP_MS above, not
  // solvable by cookie alone; single-use (takeSilentGrant) at least bounds
  // the damage to one hijacked completion, not a persistent one.
  const silentGrantToken = getCookie(c, SILENT_GRANT_COOKIE);
  if (silentGrantToken) {
    const grant = await takeSilentGrant(silentGrantToken);
    deleteCookie(c, SILENT_GRANT_COOKIE, { path: '/' });
    if (grant) {
      const completed = await completeInteraction(result.interaction.id, grant);
      if (completed.ok) return c.redirect(completed.redirectUrl, 302);
      // Fell through (interaction TTL race, practically impossible right
      // after startAuthorize just created it) — don't leave the browser
      // stuck, drop to the normal login-page prompt below.
    }
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

export async function tokenHandler(c: Context): Promise<Response> {
  const raw = new URLSearchParams(await c.req.text());
  const parsed = idpTokenBodySchema.safeParse(Object.fromEntries(raw.entries()));
  if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
  const body = parsed.data;

  if (
    !authenticateClient({
      basicAuthHeader: c.req.header('authorization'),
      bodyClientId: body.client_id,
      bodyClientSecret: body.client_secret,
    })
  ) {
    return c.json({ error: 'invalid_client' }, 401);
  }

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri) return c.json({ error: 'invalid_request' }, 400);
    const result = await exchangeAuthorizationCode({
      code: body.code,
      redirectUri: body.redirect_uri,
      codeVerifier: body.code_verifier,
      issuer: issuer(c),
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result.tokens);
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) return c.json({ error: 'invalid_request' }, 400);
    const result = await exchangeRefreshToken({
      refreshToken: body.refresh_token,
      issuer: issuer(c),
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result.tokens);
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
}

export async function userinfoHandler(c: Context): Promise<Response> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const info = await getUserinfo(token, issuer(c));
  if (!info) throw new UnauthorizedError('Invalid token', { code: 'idp_invalid_token' });
  return c.json(info);
}

export function logoutHandler(c: Context): Response {
  const q = parseQuery(c, idpLogoutQuerySchema);
  // Same allowlist as /authorize. Redirecting anywhere the caller names turns
  // our own origin into a phishing springboard, and OIDC requires the match.
  if (q.post_logout_redirect_uri && isAllowedRedirectUri(q.post_logout_redirect_uri)) {
    return c.redirect(q.post_logout_redirect_uri, 302);
  }
  return c.text('Logged out', 200);
}

// ── CAPI: your app as an OAuth *client* of Shopify's Customer Account
// API — the mirror image of the IdP section above, where Shopify is the
// client of us. Raw redirects, not our {data,meta} envelope, matching how
// authorizeHandler already hands off to a browser mid-flow. ──

function missingCapiConfig(...vars: (string | undefined)[]): boolean {
  return vars.some((v) => !v);
}

// Starts the CAPI handshake, redirecting to Shopify's authorize endpoint.
export async function startCapiAuthorizeHandler(c: Context): Promise<Response> {
  const { grant } = parseQuery(c, capiStartQuerySchema);
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

  const {
    CAPI_AUTHORIZE_ENDPOINT,
    CAPI_REDIRECT_URI,
    CAPI_SCOPE,
    CAPI_CLIENT_ID,
  } = env;
  if (
    missingCapiConfig(
      CAPI_AUTHORIZE_ENDPOINT,
      CAPI_REDIRECT_URI,
      CAPI_SCOPE,
      CAPI_CLIENT_ID,
    )
  ) {
    throw new ServiceUnavailableError('CAPI authorize flow is not fully configured', {
      code: 'capi_authorize_unconfigured',
    });
  }

  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomUUID();
  // Single-use, 10-minute TTL (idp/session_store.ts's own PENDING_TTL_SECONDS)
  // — plenty for one redirect round-trip through Shopify's login.
  // Carry the browser binding from the grant through the Shopify round trip so
  // the claim step can verify it — that is the single gate covering both the
  // relayed-grant and relayed-claim-token attacks.
  await putPending(state, {
    codeVerifier,
    redirectUri: CAPI_REDIRECT_URI as string,
    bindHash: grantBindHash,
  });

  const url = new URL(CAPI_AUTHORIZE_ENDPOINT as string);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CAPI_CLIENT_ID as string);
  url.searchParams.set('redirect_uri', CAPI_REDIRECT_URI as string);
  url.searchParams.set('scope', CAPI_SCOPE as string);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return c.redirect(url.toString(), 302);
}

// Completes the CAPI handshake and redirects to the frontend landing page.
export async function capiCallbackHandler(c: Context): Promise<Response> {
  const q = parseQuery(c, capiCallbackQuerySchema);

  // Shopify sends `error` instead of `code` when the customer denies consent
  // or the flow fails on its side — distinct from a malformed callback.
  if (q.error) {
    throw new ValidationError(q.error_description ?? `Shopify CAPI returned ${q.error}`, {
      code: 'capi_authorize_denied',
    });
  }
  if (!q.code || !q.state) {
    throw new ValidationError('Missing code or state', { code: 'capi_callback_invalid_query' });
  }

  const pending = await takePending(q.state);
  if (!pending) {
    throw new NotFoundError('Unknown or expired CAPI authorization state', {
      code: 'capi_state_not_found',
    });
  }

  const { CAPI_TOKEN_ENDPOINT, CAPI_CALLBACK_LANDING_URL } = env;
  if (missingCapiConfig(CAPI_TOKEN_ENDPOINT, CAPI_CALLBACK_LANDING_URL)) {
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
    // issueCapiSession's own missing-refresh-token guard is a plain Error
    // (it had no request boundary to map to when it was written) — this IS
    // that boundary now, so wrap anything not already an AppError.
    if (e instanceof AppError) throw e;
    throw new UpstreamError('CAPI authorization code exchange failed', {
      code: 'capi_session_issue_failed',
      cause: e,
    });
  }

  // The real session id is a 30-day bearer credential — never put it in a
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
// 30-day TTL, so a leaked id outlived the logout that was meant to kill it.
// Idempotent, and 200 even when Redis is unreachable: a logout must never fail
// in a way that leaves the client unable to finish clearing its own state. The
// swallow is reported rather than hidden, since a session that outlives its
// logout is exactly what this endpoint exists to prevent.
export async function capiLogoutHandler(c: Context): Promise<Response> {
  const header = c.req.header('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // Ignore any other bearer credential shape your app might also accept on the
  // same header — only our own opaque session ids are ours to delete.
  if (bearer.startsWith('capi_sess_')) {
    try {
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
        at: 'routes/handlers.ts:capiLogoutHandler',
        code: 'capi_session_revoke_failed',
        cause,
      });
    }
  }
  return ok(c, { revoked: true });
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
  // relayed URL put a victim into the attacker's 30-day session — and the web
  // callback clears any v1 credential first, so the attacker's won outright.
  if (!bindSecretMatches(body.bindSecret, claimed.bindHash)) {
    throw new UnauthorizedError('This sign-in link was not issued to this browser', {
      code: 'capi_claim_not_bound',
    });
  }
  return ok(c, { sessionId: claimed.sessionId });
}
