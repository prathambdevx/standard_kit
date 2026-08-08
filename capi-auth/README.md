# capi-auth — OTP login + Shopify Customer Account API custom IdP

Two independent pieces for wiring phone/email OTP login into a Bun + Hono BFF, optionally backed
by Shopify as a custom OpenID Connect identity provider for its Customer Account API (CAPI).

**Point Claude at this whole `capi-auth/` folder and say "set this up in my project"** — this
README has everything it needs: what to copy where, what env vars to add, how to register with
Shopify, and the real bugs already hit and fixed so they don't get reintroduced.

## Do you even need the custom IdP?

**If you're fine with Shopify's own hosted login screen, skip `capi-idp/` entirely.** Shopify's
Customer Account API has a plain, native flow: your app redirects the browser to Shopify's own
hosted authorization endpoint, the customer logs in *on Shopify's UI* (however Shopify has that
configured — email code, password, whatever), and Shopify redirects back to your app with an
authorization code you exchange for a CAPI token. No OTP engine, no custom IdP, no signing key, no
`/authorize`/`/token`/JWKS endpoints of your own — just a standard OAuth authorization-code
exchange against Shopify's endpoints. `capi-idp/capi/` (the token exchange + session pieces) is
still useful here on its own; you just never mount `capi-idp/idp/` or `capi-idp/routes/idp-*`
handlers, and Shopify's `/authorize` is the one your app redirects to instead of your own.

**Use `capi-idp/`'s full custom-IdP setup only when you want your *own* branded login screen**
(your own OTP flow, your own UI, your own domain) instead of Shopify's hosted one, with Shopify
still trusting your login as proof of identity for the Customer Account API. That's what the rest
of this README covers.

Either way, `otp-engine/` is fully independent of this choice — use it for phone/email OTP login
regardless of which Shopify integration path you pick, or with no Shopify at all.

## The two pieces — use either alone, or both together

| Folder | What it is | Needs the other? |
|---|---|---|
| **`otp-engine/`** | Generate, hash, store, rate-limit, and verify a 6-digit OTP over SMS/email. Delivery is pluggable — write your own vendor integration, or leave it mocked outside production. | No — usable standalone for any phone/email login. |
| **`capi-idp/`** | Turns your BFF into a real OIDC identity provider (`/authorize`, `/token`, `/.well-known/openid-configuration`, JWKS) that Shopify's Customer Account API can register as a *custom* login provider, plus the client-side half that exchanges Shopify's own CAPI grant for a session. | Yes, in practice, if you want the full custom-IdP flow — it expects a verified-OTP identity to hand off. The OIDC/OAuth mechanics themselves don't care how you verified the customer, though. |

## Prerequisites

Both pieces assume:

- **Bun + Hono** for the BFF.
- **`@devxcommerce/bff-core`** (or your own equivalent) providing: `redis()`, a Pino-style
  `log`, the `AppError` hierarchy (`ValidationError`/`UnauthorizedError`/`NotFoundError`/
  `ConflictError`/`UpstreamError`/`ServiceUnavailableError`), `cached()`, and Shopify GraphQL
  helpers (`shopifyAdminGraphQL`, `shopifyCustomerAccountGraphQL`, `initShopify`,
  `ShopifyCustomerAccountError`). **If your project doesn't have an equivalent shared core
  package, don't copy these files as-is** — you'd need to either vendor a thin version of these
  primitives first, or swap every import for your own error/logging/Redis client. This code
  leans on that abstraction throughout; it is not written against raw `ioredis`/raw `fetch`.
- **Prisma**, with a `Customer` model shaped at least like this (add fields as needed — nothing
  here reads more than these):

  ```prisma
  model Customer {
    id        String  @id @default(cuid())
    shopifyId String? @unique @map("shopify_id")
    name      String
    email     String  @unique
    phone     String? @unique
    createdAt DateTime @default(now()) @map("created_at")
    @@map("customers")
  }
  ```

  No Postgres tables are needed for OTP or IdP session state — all of that lives in Redis with
  TTLs (see below). Only the durable `Customer` identity itself is Postgres.
- **Zod** for request validation.
- **India-shaped phone validation out of the box** (`+91` and 10 digits) — this is the one place
  the reference code assumes a specific country. Swap the regex in `capi-idp/routes/schemas.ts`
  for your own format.

## Setup steps (do these in order)

1. **Copy `otp-engine/` and (if using the custom IdP) `capi-idp/`** into your BFF's `src/`. Each
   subfolder here mirrors a standard `services/repositories/middleware/routes` BFF layout, so you
   can drop each file into the matching directory in your own project structure.
2. **Fix every import path** — these were copied out of a project with a specific `src/` layout
   of its own. Update relative imports (`../../config/env`, `../db/client`, etc.) to match
   wherever you actually place these files.
3. **Add the env vars** (full list below) to your env schema and `.env.example`.
4. **Wire the routes** — `capi-idp/routes/index.ts` mounts everything under one Hono router
   (`/otp/send`, `/otp/verify`, `/otp/details`, `/otp/resend`, the IdP endpoints if you're using
   them, the CAPI endpoints). Mount it in your app's entry point at whatever base path you want —
   `issuer()` and the CAPI handoff URL in `routes/handlers.ts` currently assume `/auth`, adjust if
   you mount it elsewhere.
5. **Generate an IdP signing key** (see `IDP_SIGNING_KEY` below) — required for any real
   (non-local) environment, and only relevant if you're using the custom IdP.
6. **Register with Shopify** — see "Shopify-side setup" below. This is the one step that can't be
   automated from inside your codebase; it's clicking through Shopify's own admin UI.
7. **Adapt the project-specific bits** — see "What to decide for your own project" below. Don't
   skip this; a couple of pieces (synthetic email domain, marketing-consent field mapping, phone
   format) need real decisions for your own brand/store, not just a copy-paste.

## `otp-engine/` — files and env vars

| File | What it does |
|---|---|
| `index.ts` | Core engine: generate a code, hash it (never stored plaintext), create/verify/resend a challenge, constant-time comparison. |
| `provider.ts` | Delivery abstraction — swap between the in-house engine and a real vendor without touching callers. See the comment at the top for the pattern to follow when you add one. |
| `sms.ts` / `email.ts` | Delivery-channel stubs for the in-house engine — replace with real SMS/email sending, or leave mocked outside production. |
| `rate_limit.ts` | Per-identity (phone or email) and per-IP send caps, on top of `repositories/otp_challenges.ts`'s own resend cooldown. **Read the comment at the top of this file before changing the numbers** — the send cooldown is the actual anti-abuse throttle; the hourly/daily counters are a looser backstop and should stay generous enough that real SMS delivery delays don't lock out legitimate customers. |
| `metrics.ts` | Latency/success instrumentation hooks. |
| `repositories/otp_challenges.ts`, `repositories/otp_attempts.ts` | Redis-backed challenge + attempt-counter storage, all TTL'd, no cleanup job needed. |

**Env vars:**

```bash
OTP_HASH_SECRET=          # required at call time — HMAC secret for hashing codes at rest. Generate with: openssl rand -hex 32
```

**Verified against NIST SP 800-63B + OWASP** — see `otp-engine/README.md` for the full checklist
(secure RNG, hashed-not-plaintext storage, constant-time compare, atomic single-use + attempt cap,
no enumeration, rate-limit-can't-be-IP-spoofed, fails closed on a Redis error). That doc also has
real measured latency numbers if you need to set expectations with a client/PM.

## `capi-idp/` — files and env vars

| File | What it does |
|---|---|
| `idp/provider.ts` | The OIDC provider mechanics: starts an authorization interaction, issues/verifies auth codes, completes an interaction once OTP succeeds, discovery document + JWKS. Only needed for the custom-IdP path — skip if you're using Shopify's own hosted login. |
| `idp/session_store.ts` | Redis storage for in-flight IdP interactions and auth codes (short TTL — these are single-use handshake state, not customer sessions). |
| `idp/signing_key.ts` | Generates/loads the RS256 keypair used to sign ID tokens. **Falls back to an on-disk, auto-generated key when `IDP_SIGNING_KEY` is unset — that fallback is fine for local dev only.** Any real deployed environment needs a static, deliberately-generated, persisted key: an ephemeral container filesystem regenerates it on every restart/redeploy/scale-out, which would invalidate every JWKS Shopify has cached and break every live session. Generate one per environment (dev/staging/prod each get their *own* key — never share one across environments; a compromised dev key with looser access controls would otherwise forge tokens your prod store would accept). |
| `capi/token_exchange.ts` | Talks to Shopify's own OAuth token endpoint — exchanges an authorization code (or refresh token) for a CAPI access/refresh/id token set. Needed regardless of which login path (custom IdP or Shopify-hosted) you use. |
| `capi/session.ts` | Resolves/refreshes a CAPI session; `callWithCapiExpiry()` wraps any Shopify Customer Account API call and cleanly converts a server-side-revoked session into a 401 instead of an unhandled 502 — **use this wrapper (or the pattern in `middleware/customer.ts`) at every call site that uses a resolved CAPI access token.** See "Known gotchas" below for why this matters. |
| `capi/session_store.ts` | Redis storage for the actual CAPI session (30-day TTL, matching the refresh token's real lifetime), plus the single-use claim-token exchange the frontend uses to pick up its session id after the OAuth redirect chain completes. |
| `capi/customer.ts` | Fetches the CAPI-authenticated customer's identity from Shopify's Customer Account API. |
| `shopify-admin/customer-lookup.ts` | Look up an existing Shopify customer by phone or email via the Admin API — the "does this identity already exist" check for a verified OTP. Only relevant to the custom-IdP path (Shopify's own hosted login handles this itself). |
| `shopify-admin/customer-create.ts` | Creates a brand-new Shopify customer for a phone/email-verified signup with no existing record. **Read the comment on `CREATE_CUSTOMER_MUTATION` before touching this file** — see "Known gotchas" below. |
| `shopify-admin/synthetic-email.ts` | Shopify requires every customer to have an email. A phone-only signup gets a synthetic placeholder here until a real address is learned later (e.g. from a checkout). **The domain here is the most project-specific decision in the whole kit — see below.** |
| `routes/index.ts`, `routes/handlers.ts`, `routes/schemas.ts` | The Hono routes: OTP send/verify/resend/details, the IdP endpoints (`/authorize`, `/token`, `/.well-known/*`, JWKS) if using the custom IdP, and the CAPI endpoints (`/capi/start`, `/capi/callback`, `/capi/claim`, `/capi/logout`). |
| `middleware/customer.ts` | Route-gating middleware — resolves a `capi_sess_<uuid>` session id from the `Authorization: Bearer` header to a local customer. If your app also has some other login path issuing a different bearer-credential shape on the same header, branch on a prefix the same way this file's own comment describes — resolve each kind through its own function, cached under its own key prefix. |
| `repositories/customers.ts`, `customer_signup.ts` | Postgres upsert logic for the local `Customer` row, keyed by `shopifyId`, lazily backfilled from Shopify on a cache miss. |
| `repositories/idp_interactions.ts`, `idp_auth_codes.ts` | Redis-backed short-lived OIDC handshake state (custom-IdP path only). |

**Env vars:**

```bash
# Your own IdP (Shopify is the OAuth CLIENT of this) — only needed for the custom-IdP path
IDP_SIGNING_KEY=                    # RS256 private JWK, JSON-stringified. Required in any real env — see idp/signing_key.ts note above
IDP_CLIENT_ID=                      # issued when you register your IdP with Shopify
IDP_CLIENT_SECRET=
IDP_ALLOWED_REDIRECT_URIS=          # comma-separated EXACT redirect URIs — /authorize fails closed while unset. Never use prefix matching.
LOGIN_PAGE_URL=                     # your frontend's OTP login page — /authorize redirects the browser here

# Your BFF as an OAuth CLIENT of Shopify's own CAPI — needed either way
CAPI_CLIENT_ID=
CAPI_CLIENT_SECRET=                 # only if your CAPI registration is a confidential client
CAPI_TOKEN_ENDPOINT=                # discover per-shop: https://shopify.com/authentication/<shop-id>/oauth/token
CAPI_AUTHORIZE_ENDPOINT=            # https://shopify.com/authentication/<shop-id>/oauth/authorize — or Shopify's own hosted login endpoint if skipping the custom IdP
CAPI_REDIRECT_URI=                  # must match byte-for-byte what's registered with Shopify
CAPI_SCOPE=                         # e.g. "openid email customer-account-api:full"
CAPI_CALLBACK_LANDING_URL=          # where the browser lands after a successful CAPI handoff
CAPI_CUSTOMER_ACCOUNT_HOST=         # https://<shop>.account.myshopify.com

# Shared with the rest of your Shopify integration
SHOPIFY_ADMIN_API_TOKEN=
SHOPIFY_STORE_DOMAIN=
SHOPIFY_API_VERSION=

# Phone-only signups need a synthetic email domain — only relevant if you build your own
# signup flow (custom-IdP path); see synthetic-email.ts note below
SYNTHETIC_EMAIL_DOMAIN=
```

## Shopify-side setup

This has to happen by clicking through Shopify's own UI — there's no API for it.

### If you're using Shopify's own hosted login (skipping `capi-idp/idp/`)

1. In Shopify Admin → Settings → Customer accounts, make sure **New customer accounts** is
   enabled (Shopify Plus required for the Customer Account API).
2. Register your app as an OAuth client for the Customer Account API — this is what generates
   `CAPI_CLIENT_ID` (and `CAPI_CLIENT_SECRET` if confidential).
3. Register your app's exact callback URL (`CAPI_REDIRECT_URI`) — it must match byte-for-byte,
   including scheme and trailing slashes.
4. Point `CAPI_AUTHORIZE_ENDPOINT`/`CAPI_TOKEN_ENDPOINT` at Shopify's own endpoints for your shop
   (discoverable per-shop; Shopify's docs describe the exact discovery path).
5. Your app's "sign in" button redirects straight to `CAPI_AUTHORIZE_ENDPOINT` — the customer logs
   in on Shopify's own hosted screen, then lands back on your `CAPI_REDIRECT_URI` with a code.
   `capi-idp/routes/handlers.ts`'s CAPI callback handler + `capi/token_exchange.ts` take it from
   there.

### If you're building the full custom-IdP flow (your own login screen)

Everything above, plus:

1. **Register your BFF as a *custom* identity provider** for the Customer Account API (Shopify
   Admin → Settings → Customer accounts → look for the custom-provider / external IdP option;
   Shopify Plus required). This is a separate registration from the plain CAPI client above.
2. **Point Shopify's IdP discovery at your BFF's `/.well-known/openid-configuration`** — this is
   what makes Shopify trust *your* login flow as the identity source instead of its own hosted
   screen.
3. **Generate and register `IDP_CLIENT_ID`/`IDP_CLIENT_SECRET`** — the credentials *Shopify* uses
   to authenticate to *your* IdP (the reverse direction from the CAPI credentials above).
4. **Register the redirect URI(s) Shopify will use against your IdP** (`IDP_ALLOWED_REDIRECT_URIS`)
   — read directly off Shopify's identity-provider settings page once you've registered.
5. Do all of this **separately per environment** (dev/staging/prod each need their own Shopify
   registration and their own signing key, since each has a different domain).

## Known gotchas — already hit and fixed once; don't reintroduce them

- **`customerCreate`'s `userErrors` has no `code` field.** Querying `userErrors { field message
  code }` makes Shopify reject the *entire mutation* at schema-validation time
  (`undefinedField`) — before touching any data — 502ing every signup unconditionally, not just
  duplicates. Confirmed live against Shopify's Admin API and against Shopify's own docs: the
  Admin API's plain `UserError` type (unlike the Storefront API's `CustomerUserError`) only has
  `field` and `message`. Query `userErrors { field message }` only.
- **`field` alone isn't enough to detect "already taken."** Shopify returns the same
  `field: ['email']` shape for a genuine duplicate *and* for a plain validation failure (e.g.
  `"Email is invalid"`). Checking only `field` reports a malformed address as "an account with
  this email already exists" — wrong status, and it sends the customer to log in instead of
  fixing what they typed. Require the message to actually match `/already been taken/i` before
  treating a single error as a conflict; anything else (including other single-field errors)
  should fall through to the generic upstream failure.
- **A server-side session revoke needs explicit handling at *every* call site that uses a
  resolved CAPI access token.** If a customer signs out directly on Shopify's own
  checkout/account domain, Shopify revokes that session server-side immediately — but your own
  locally-recorded expiry has no way to see that. The next real Shopify Customer Account API call
  throws a live 401 (`ShopifyCustomerAccountError`, `code: 'customer_token_expired'`), and if
  that's uncaught it surfaces as an unhandled 502. This isn't a single fix — it needs catching at
  *every independent place* your code resolves a CAPI session to an access token (in the
  reference implementation this was three separate call sites, each with its own separate
  identity resolution that bypassed the others). Use `capi/session.ts`'s `callWithCapiExpiry()`
  wrapper (or copy its pattern) at each one: catch `ShopifyCustomerAccountError` with that code,
  delete the dead session (best-effort — a cleanup failure must not turn a clean 401 back into a
  502), and resolve to whatever that call site's own contract expects (throw vs. return null).
- **Never log a raw CAPI session id.** It *is* the bearer credential — `Authorization: Bearer
  capi_sess_<uuid>` — so logging it plaintext (even in an error path) is a credential leak,
  worse specifically in a cleanup-failure branch where the session may still be live. Hash it
  first: `createHash('sha256').update(sessionId).digest('hex').slice(0, 32)`.
- **`smsMarketingConsent` on `customerCreate` rejects the whole mutation if present at all
  without a phone on the input** — true or false, its mere presence is the trigger, not its
  value. An email-channel signup with no phone typed still 502s if this field is forwarded in any
  explicit state. Omit it entirely when there's no phone, don't just default it to `false`.
- **OTP rate limits: keep the IP cap meaningfully above the per-identity cap, not roughly equal.**
  One IP is legitimately many people (shared office/home WiFi) — if the two caps are close, the
  IP cap becomes the effective limit the moment 2-3 people share a connection, defeating the
  point of having a separate per-identity limit at all. The reference numbers here are 20/hour +
  40/day per identity, 60/hour per IP (a ~3x ratio) — the 30-second resend cooldown
  (`otp-engine`'s own challenge TTL logic) is the actual anti-pumping-fraud throttle; the
  hourly/daily counters are a looser backstop and shouldn't be what a customer trips over a slow
  SMS delivery.
- **The typed, unverified second field in a signup form (e.g. a phone typed during an
  email-channel signup) is never pre-checked against your DB or Shopify** — it's trusted as
  typed, and Shopify's own `customerCreate` uniqueness constraint is what catches a duplicate
  (atomically, avoiding a check-then-create race). This is a deliberate tradeoff, not an
  oversight — document it as an accepted risk in your own security notes if you keep this shape.

## What to decide for your own project

- **`synthetic-email.ts`'s domain and format** — needs a real domain *you* own and control DNS
  for, not a placeholder. This is a real decision (what happens when a phone-only customer's
  synthetic address is later seen by an email tool, a support agent, an export) — don't just copy
  a domain from elsewhere.
- **Marketing-consent field mapping in `customer-create.ts`** (`acceptEmailMarketing`/
  `acceptSmsMarketing` → Shopify's nested `marketingState` input) — this maps a specific signup
  form's fields; adjust to whatever consent checkboxes your own signup form actually has.
- **Phone number format** — the reference regex (`+91` and 10 digits) is India-specific. Swap it
  for your own country's format in `capi-idp/routes/schemas.ts`.
- **The exact OTP rate-limit numbers** — the ratio logic (IP cap meaningfully above identity cap)
  is the reusable part; the actual numbers are a fraud/UX tradeoff for *your* traffic and cost
  tolerance, not a universal constant.
- **Everything else** (the OIDC mechanics, the CAPI token exchange, the revoked-session handling,
  the challenge/attempt state machine) is genuinely generic — built on `@devxcommerce/bff-core`
  primitives any project using that shared package already has, not on project-specific business
  logic.
