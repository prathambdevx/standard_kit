import { z } from 'zod';

export const otpChannelSchema = z.enum(['mobile', 'email']);

// Hard-reject malformed phone numbers at the schema level (SMS-pumping fraud
// protection) — only applies to the mobile channel; email usernames pass
// through. The +91-and-[6-9]-then-9-digits shape below is India-specific
// (this kit's origin project) — swap in your own country's phone format, but
// keep it a real numbering-plan check, not just a digit count: a looser
// \d{10} let a structurally-valid-but-fake number (e.g. +910000000000) reach
// Shopify's customerCreate, which rejects it as "Phone is invalid" — a
// ValidationError that strands the customer on a retry that fails identically
// every time, if it's not caught here first.
export const otpSendSchema = z
  .object({
    username: z.string().min(1),
    channel: otpChannelSchema,
  })
  .refine((v) => v.channel !== 'mobile' || /^\+91[6-9]\d{9}$/.test(v.username), {
    message: 'Please enter a valid phone number',
    path: ['username'],
  })
  .refine((v) => v.channel !== 'email' || z.string().email().safeParse(v.username).success, {
    message: 'Email OTP requires a valid email address',
    path: ['username'],
  });

export const otpResendSchema = z.object({
  otpId: z.string().min(1),
});

export const otpVerifySchema = z.object({
  otpId: z.string().min(1),
  // Exactly 6 digits — genCode() only ever mints that shape, so anything else
  // cannot match. Rejecting here (before claimAttempt) means a typo costs a 400
  // rather than one of the customer's 5 attempts.
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// The mobile channel's phone is never taken from the client here — the
// details step recovers it from the already-verified challenge
// (otp_challenges.username). The `phone` field below is only reachable by
// the email channel, whose own number was never OTP-proven; see its comment.
// firstName/lastName required: Customer.name (prisma/schema.prisma) is a
// non-nullable column, not a Shopify constraint (Shopify's own CustomerInput
// requires neither). email is a policy decision, not a Shopify requirement —
// emailRequired is enforced client-side only.
export const otpDetailsSchema = z.object({
  otpId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Optional because verify returns emailRequired:false on the email channel,
  // where the address is already proven and the handler binds the verified value
  // regardless of what the client sends. A required field here would 400 any
  // client that honours that flag.
  email: z.string().email().optional(),
  // Phone the email-channel customer types on their own signup, saved as-is —
  // same trust level as `email` above (neither is OTP-proven, both are typed).
  // A prior version of this schema rejected phone from the body outright,
  // reasoning that an attacker could self-verify an email OTP and plant a
  // victim's number as a login identity on the account they just created.
  // That's still technically true, but it's a rare/low-value attack (a typed
  // string, no proof of possession, on a rate-limited endpoint) weighed
  // against a real UX cost on every legitimate signup — the details form
  // already asks for this field and previously threw the answer away. The
  // Document this as an accepted tradeoff if you keep this shape: whoever's
  // number lands here can later log in via their own phone OTP, same as the
  // (already-accepted) symmetric case on `email` above.
  // Same [6-9] numbering-plan check as otpSendSchema's refine above — see that
  // comment for why a looser \d{10} isn't enough.
  phone: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, 'Please enter a valid phone number')
    .optional(),
  // Maps onto Shopify's own consent input directly (see
  // shopify-admin/customer-create.ts) — adjust to whatever consent
  // checkboxes your own signup form actually has.
  acceptEmailMarketing: z.boolean().optional(),
  acceptSmsMarketing: z.boolean().optional(),
});

// client_id is intentionally optional here — a missing/empty value must still
// reach startAuthorize()'s own unauthorized_client branch (raw OAuth2 error
// JSON), not fail this schema and get wrapped in our own {error,meta}
// envelope by the global error handler.
export const idpAuthorizeQuerySchema = z.object({
  client_id: z.string().optional(),
  redirect_uri: z.string().min(1).optional(),
  response_type: z.string().min(1).optional(),
  state: z.string().optional(),
  nonce: z.string().optional(),
  scope: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  // OIDC prompt (§3.1.2.1) — only 'none' is acted on. Free string, not an enum,
  // so an unrecognised value degrades to today's behaviour instead of a 400.
  prompt: z.string().optional(),
});

export const idpLogoutQuerySchema = z.object({
  post_logout_redirect_uri: z.string().optional(),
});

// The /token endpoint receives application/x-www-form-urlencoded per the
// OAuth2/OIDC spec, not JSON — this schema validates the parsed
// URLSearchParams object, not a JSON body (see handlers.ts).
export const idpTokenBodySchema = z.object({
  grant_type: z.string().min(1),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

// Shopify's CAPI redirect after login: either `code`+`state` on success, or
// `error` (+ optional `error_description`) if the customer denied consent or
// something else failed on Shopify's side. All optional here so the handler
// can distinguish "denied" from "malformed" and throw a specific AppError for
// each, rather than one generic invalid_query for both.
export const capiCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const capiClaimBodySchema = z.object({
  claimToken: z.string().min(1),
  // Proves this browser is the one that started the login: the web app mints it
  // into sessionStorage and sends it here. Deliberately a body field, not a
  // cookie — a cookie would need SameSite=None to survive this cross-origin
  // POST, which local/tunnel setups drop, making the control untestable in the
  // only environments we can actually exercise it in. Required — without it,
  // any claim token relayed to another browser succeeds outright.
  bindSecret: z.string().min(1),
});

// grant is only present on the silent-CAPI-handoff path (handlers.ts's
// respondWithSilentCapiHandoff) — absent for any other/future caller of this
// endpoint, which proceeds unchecked as before. return_to is only present on
// the mobile checkout-warm-up path (capiCheckoutGrantHandler's startUrl) —
// validated against an allowlist in capi_handlers.ts, never trusted as-is.
export const capiStartQuerySchema = z.object({
  grant: z.string().optional(),
  return_to: z.string().optional(),
});
