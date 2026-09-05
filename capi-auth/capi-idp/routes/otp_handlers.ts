// ── OTP: our own API, follows the standard {data,meta}/{error,meta} envelope ──
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
import { randomUUID } from 'node:crypto';
import { log, NotFoundError, TooManyRequestsError, ValidationError } from '@devxcommerce/bff-core';
import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { env } from '../../config/env';
import { checkEmailDomain, isWellFormedEmail } from '../email-domain';
import { parseBody } from '../../lib/parse-body';
import { ok } from '../../lib/response';
import { createCustomerFromSignup } from '../../repositories/customer_signup';
import { findOrLazyFillByEmail, findOrLazyFillByPhone } from '../../repositories/customers';
import { getInteraction } from '../../repositories/idp_interactions';
import {
  claimChallengeForSignup,
  consumeSignupClaim,
  getChallenge,
  releaseSignupClaim,
} from '../../repositories/otp_challenges';
import { completeInteraction } from '../../services/idp/provider';
import { putSilentGrant } from '../../services/idp/session_store';
import { createOtp, resendOtp, verifyOtp } from '../../services/otp_engine/provider';
import {
  checkOtpSendRateLimit,
  checkOtpVerifyRateLimit,
} from '../../services/otp_engine/rate_limit';
import { createShopifyCustomer } from '../../services/shopify/admin/customer-create';
import {
  findCustomerByEmail,
  findCustomerByPhone,
} from '../../services/shopify/admin/customer-lookup';
import { updateShopifyCustomer } from '../../services/shopify/admin/customer-update';
import { otpDetailsSchema, otpResendSchema, otpSendSchema, otpVerifySchema } from './schemas';
import { bffBaseUrl, INTERACTION_COOKIE, missingCapiConfig } from './shared';
function clientIp(c: Context): string {
  const parts = c.req.header('x-forwarded-for')?.split(',') ?? [];
  const last = parts.at(-1)?.trim();
  return last && /^[0-9a-f.:]+$/i.test(last) ? last : 'unknown';
}

// Sends an OTP to the customer's phone or email address.
export async function sendOtpHandler(c: Context): Promise<Response> {
  const body = await parseBody(c, otpSendSchema);
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

// Verifies the code, resolves/lazily-fills the local Customer row (phone
// lookup). Three outcomes: no Shopify customer for this phone at all
// → details_required (a genuinely new signup); otherwise, if a pending
// IdP interaction cookie is present, completes it and returns the Shopify
// redirect; otherwise just confirms the phone is verified (no IdP
// interaction; e.g. a standalone OTP check).
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
  const lookup =
    result.channel === 'email'
      ? await findOrLazyFillByEmail(result.username)
      : await findOrLazyFillByPhone(result.username);
  if (lookup.status === 'ready') {
    return respondWithCustomerSession(c, lookup.customer, challenge?.createdAt ?? null);
  }

  // Two cases land here and both go through the details form: a genuinely new
  // customer ('new'), and one Shopify already knows whose profile is missing the
  // other identifier ('incomplete' — see IdentityLookup). The 'incomplete' case
  // is deliberately NOT logged straight in: this kit's rule is that every
  // customer has both a usable email and a phone, and this is the one gate where
  // that can be enforced. Their existing record is patched, never duplicated, so
  // order history survives — the submit handler decides create-vs-patch itself.
  const verifiedEmail = result.channel === 'email' ? result.username : null;
  const admin = lookup.status === 'incomplete' ? lookup.admin : null;
  return ok(c, {
    status: 'details_required' as const,
    otpId: body.otpId,
    emailRequired: !verifiedEmail,
    // Prefilled from what Shopify already holds, so a returning customer isn't
    // retyping their own name to supply one missing field.
    prefill: {
      firstName: admin?.firstName ?? null,
      lastName: admin?.lastName ?? null,
      email: verifiedEmail,
    },
  });
}

// Same duration as OTP_TTL_MS in services/otp_engine/index.ts, but counted from when
// the challenge was CONSUMED (its updatedAt, bumped by markConsumed), not the
// original send. Defense in depth alongside claimChallengeForSignup's atomic claim below —
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
  // (see otpDetailsSchema's phone field comment — product decision, not an
  // oversight, treat this as an accepted tradeoff).
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
  // Only 'undeliverable' (confirmed no MX records) rejects — a slow/unreachable
  // resolver must never block a real signup over a DNS hiccup.
  if ((await checkEmailDomain(email)) === 'undeliverable') {
    throw new ValidationError('Email OTP requires a valid email address', {
      code: 'invalid_payload',
    });
  }
  // Phone is deliberately NOT required to match it: email is the channel that has
  // to work (order confirmations, receipts), phone is only a login convenience.
  // An email-channel signup with no phone is a complete customer.
  // Claim the challenge BEFORE calling Shopify, not after: a claim placed at
  // the end of the flow is cleanup, not a lock — two concurrent submits (a
  // double-tap on a flaky connection is enough, no attacker required) could
  // both pass the checks above and both reach createShopifyCustomer, and
  // Shopify's own email uniqueness is not a documented guarantee under
  // concurrency. The atomic in-flight stamp here means only one ever proceeds;
  // the loser gets a clean 404 rather than racing an external API.
  const claimed = await claimChallengeForSignup(body.otpId);
  if (!claimed) {
    throw new NotFoundError('OTP was not verified for this id', { code: 'otp_not_verified' });
  }
  // Create vs. patch is decided HERE, by re-resolving the identity against
  // Shopify — never from a flag the client round-trips, which would be a way to
  // graft an email onto someone else's account. An existing customer must be
  // PATCHED: customerUpdate keeps their id, so their orders and addresses stay
  // attached, where customerCreate would collide on the identifier they already
  // hold or mint a duplicate showing none of their history.
  const existing =
    challenge.channel === 'mobile'
      ? await findCustomerByPhone(challenge.username)
      : await findCustomerByEmail(challenge.username);

  let shopifyCustomer: { id: string; email: string | null };
  try {
    shopifyCustomer = existing
      ? await updateShopifyCustomer({
          id: existing.id,
          // Only ever fills a BLANK field. The OTP proved one identifier; the
          // other is merely typed, so overwriting a value Shopify already holds
          // would let a typed string replace a real one on a live account.
          // Marketing consent is deliberately not applied here either — an
          // existing customer supplying a missing field is not newly consenting.
          ...(isWellFormedEmail(existing.email) ? {} : { email }),
          ...(!existing.phone && phone ? { phone } : {}),
          ...(existing.firstName ? {} : { firstName: body.firstName }),
          ...(existing.lastName ? {} : { lastName: body.lastName }),
        })
      : await createShopifyCustomer({
          phone,
          email,
          firstName: body.firstName,
          lastName: body.lastName,
          acceptEmailMarketing: body.acceptEmailMarketing,
          acceptSmsMarketing: body.acceptSmsMarketing,
        });
  } catch (err) {
    // No Shopify customer was created, so this challenge hasn't been spent —
    // release it. Without this the customer is stranded on the very errors
    // they're most likely to hit and could fix: a duplicate email (they meant
    // to log in), a typo'd field, or a transient Shopify failure. Their retry
    // would answer `otp_not_verified`, and going back to resend would answer
    // `otp_not_found`, both because the record was destroyed by the claim.
    //
    // Best-effort, and deliberately rethrows the ORIGINAL error: a Redis blip
    // here must not turn a precise "that email is already registered" into an
    // unclassified 500, which is exactly the message the customer needs to act on.
    try {
      await releaseSignupClaim(body.otpId, claimed.claimToken);
    } catch (releaseErr) {
      log.warn({ err: releaseErr, otpId: body.otpId }, 'failed to release signup claim');
    }
    throw err;
  }
  // The Shopify customer now exists, so this challenge is spent and must never
  // mint a second one — but only once EVERY step that can still fail is done.
  // Consuming here rather than before the local write is what keeps a Postgres
  // failure from recreating the exact dead-end this handler exists to avoid:
  // with the challenge already gone, the retry answers `otp_not_verified` and
  // the customer is stranded again. Releasing instead leaves them a retry that
  // reaches Shopify and returns a real, actionable `customer_email_taken` —
  // their account does exist by then, so "log in instead" is the right answer.
  let customer: Awaited<ReturnType<typeof createCustomerFromSignup>>;
  try {
    customer = await createCustomerFromSignup({
      shopifyId: shopifyCustomer.id,
      name: `${body.firstName} ${body.lastName}`.trim(),
      email: shopifyCustomer.email ?? email,
      // Shopify's stored value, not the typed one — it normalises the number and
      // keeps none at all when it rejects it, so trusting our input drifts the row.
      phone: shopifyCustomer.phone ?? null,
    });
  } catch (err) {
    try {
      await releaseSignupClaim(body.otpId, claimed.claimToken);
    } catch (releaseErr) {
      log.warn({ err: releaseErr, otpId: body.otpId }, 'failed to release signup claim');
    }
    throw err;
  }
  // Ownership-checked: if this attempt overran its lease and another has since
  // claimed the challenge, deleting it would pull the record out from under an
  // attempt still in flight.
  //
  // Best-effort for the mirror-image reason to the releases above: the signup has
  // ALREADY succeeded, so failing the request over a cleanup error would tell
  // the customer their signup failed when it didn't. A challenge that outlives
  // this is bounded by DETAILS_SUBMISSION_WINDOW_MS.
  try {
    const consumed = await consumeSignupClaim(body.otpId, claimed.claimToken);
    if (!consumed) {
      log.warn(
        { otpId: body.otpId },
        'signup lease was taken over before this attempt finished; leaving the challenge to its current owner',
      );
    }
  } catch (deleteErr) {
    log.warn({ err: deleteErr, otpId: body.otpId }, 'failed to delete spent signup challenge');
  }
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

// Path A: stashes a single-use grant and hands back a URL that kicks off the
// CAPI dance. Does NOT set idp_silent_grant here — this response is to a
// cross-origin fetch() (web app's origin -> BFF's origin), and browsers won't
// reliably persist a Set-Cookie from that kind of request even with
// SameSite=None;Secure (Chrome's third-party-cookie blocking applies to the
// SETTING request itself, not just later sending). The cookie is set instead
// in startCapiAuthorizeHandler (capi_handlers.ts), on the response to the real top-level
// navigation the frontend does to capiHandoffUrl.
async function respondWithSilentCapiHandoff(
  c: Context,
  customer: { shopifyId: string; email: string },
): Promise<Response> {
  const { CAPI_AUTHORIZE_ENDPOINT, CAPI_REDIRECT_URI, CAPI_SCOPE, CAPI_CLIENT_ID } = env;
  if (missingCapiConfig(CAPI_AUTHORIZE_ENDPOINT, CAPI_REDIRECT_URI, CAPI_SCOPE, CAPI_CLIENT_ID)) {
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
