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

## The one rule: every customer has a usable email

This kit enforces a single invariant at login, and a lot of complexity disappears because of it.
**Email is mandatory; phone is not.** Email is the channel that actually has to work — order
confirmations, receipts, password-less recovery, marketing. A phone is an OTP login convenience, so a
customer who signs up by email and never gives one is complete as far as this kit is concerned.

**Shopify itself requires neither.** Verified live against the Admin API — `customerCreate` accepts a
customer with no email, with no phone, and with *neither*:

| Input | Result |
|---|---|
| phone only, no email | accepted, `email: null` |
| phone + explicit `email: null` | accepted, `email: null` |
| neither phone nor email | accepted, both null |

Checkout doesn't force it either: Shopify's checkout wants *a* contact method, and if the store's
customer-contact setting permits phone, a customer completes checkout and gets SMS confirmations with
no email ever recorded. That's how a real store ends up with phone-only customers who nonetheless have
full order histories. **So "every customer has a usable email" is your product rule, not a platform
constraint — and this auth layer is the only place it can be enforced.**

### How the gate works

`repositories/customers.ts`'s `findOrLazyFillByPhone`/`ByEmail` return an `IdentityLookup`:

| Status | Meaning | What happens |
|---|---|---|
| `ready` | has a usable email | logged in normally |
| `incomplete` | Shopify knows them, but has no usable email | **not** logged in — `details_required`, prefilled with the name Shopify already holds |
| `new` | Shopify has never seen this identity | `details_required`, a genuine signup |

Only the **phone** channel can produce `incomplete` — an email-channel login has by definition just
proven a usable address, so `findOrLazyFillByEmail` never returns it.

The details form asks for an email (required) and optionally a phone. For `incomplete`,
`submitOtpDetailsHandler` **patches their existing record** (`customerUpdate` via
`shopify-admin/customer-update.ts`), so **their orders and addresses stay attached**. It decides
create-vs-patch by re-resolving the identity against Shopify itself — never from a flag the client
sends back, which would be a way to graft an email onto someone else's account. It only ever fills a
*blank* field: the OTP proved one identifier, the other is merely typed, so a typed string never
overwrites a real value Shopify already holds. Marketing consent is not applied on the patch path
either — an existing customer supplying a missing field is not newly consenting.

Calling `customerCreate` for this case instead is the bug to avoid: Shopify enforces phone uniqueness,
so it fails outright with "Phone has already been taken" — and if it *did* succeed you'd have a
duplicate customer showing none of their history.

### What this replaces

A synthetic-placeholder scheme (`<phone>@your-domain`) plus an `orders/paid` webhook to heal it later.
Both are gone, and with them: the synthetic-domain decision (previously the most project-specific
choice in the whole kit), a `hasRealEmail` flag that had to be threaded through every downstream caller
(carts, checkout, order writes), and the webhook wiring a consumer needed just to fix email data.

Legacy phone-only customers self-heal with no batch job: the first time one logs in, the gate collects
their email. Ones who never come back never needed an email anyway.

### Collisions: measured, and rare enough to ignore

If the customer supplies an email that already belongs to a *different* Shopify customer, they get an
actionable error and retry with another address. This kit does **not** try to merge the two accounts —
and the numbers say it shouldn't. Full data in
[Open items](#open-items--known-gaps-deliberately-unsolved); short version: the harmful outcome is a
fraction of a percent, and it is not what a merge flow would fix.

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
   `issuer()` in `routes/shared.ts` and the CAPI handoff URL in `routes/otp_handlers.ts` currently assume `/auth`, adjust if
   you mount it elsewhere.
5. **Generate an IdP signing key** (see `IDP_SIGNING_KEY` below) — required for any real
   (non-local) environment, and only relevant if you're using the custom IdP.
6. **Register with Shopify** — see "Shopify-side setup" below. This is the one step that can't be
   automated from inside your codebase; it's clicking through Shopify's own admin UI.
7. **Wire logout end-to-end, including the frontend.** `POST /capi/logout` revokes your own
   session and returns a `logoutUrl`; your frontend must then do a **top-level navigation** to it
   (`window.location.href = logoutUrl`), not a `fetch`. Skipping this leaves Shopify's own session
   alive, which silently hijacks the next login — the single worst failure mode in this flow, see
   "Known gotchas". Race the revoke call against a short timeout so a slow or failed revoke still
   lets the customer finish clearing their local state.
8. **Adapt the project-specific bits** — see "What to decide for your own project" below. Don't
   skip this; a couple of pieces (marketing-consent field mapping, phone format) need real
   decisions for your own brand/store, not just a copy-paste.

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
| `capi/handshake.ts` | `beginCapiHandshake()` — mints PKCE + state, writes the pending record, and builds Shopify's authorize URL. The one entry point `routes/capi_handlers.ts`'s `startCapiAuthorizeHandler` uses to start the redirect, whether it's an ordinary login or the checkout-warmup path (via its `extras` param — `bindHash`/`grantToken`/`returnTo`). |
| `capi/token_exchange.ts` | Talks to Shopify's own OAuth token endpoint — exchanges an authorization code (or refresh token) for a CAPI access/refresh/id token set. Needed regardless of which login path (custom IdP or Shopify-hosted) you use. |
| `capi/session.ts` | Resolves/refreshes a CAPI session; `callWithCapiExpiry()` wraps any Shopify Customer Account API call and cleanly converts a server-side-revoked session into a 401 instead of an unhandled 502 — **use this wrapper (or the pattern in `middleware/customer.ts`) at every call site that uses a resolved CAPI access token.** `examples/using-call-with-capi-expiry.ts` shows both the throwing and return-null shapes extracted from real call sites. See "Known gotchas" below for why this matters. |
| `capi/session_store.ts` | Redis storage for the actual CAPI session (30-day TTL, matching the refresh token's real lifetime), plus the single-use claim-token exchange the frontend uses to pick up its session id after the OAuth redirect chain completes. |
| `capi/customer.ts` | Fetches the CAPI-authenticated customer's identity from Shopify's Customer Account API. |
| `shopify-admin/customer-lookup.ts` | Look up an existing Shopify customer by phone or email via the Admin API — the "does this identity already exist" check for a verified OTP. Only relevant to the custom-IdP path (Shopify's own hosted login handles this itself). |
| `shopify-admin/customer-create.ts` | Creates a brand-new Shopify customer for a phone/email-verified signup with no existing record. **Read the comment on `CREATE_CUSTOMER_MUTATION` before touching this file** — see "Known gotchas" below. |
| `shopify-admin/customer-update.ts` | Patches an EXISTING Shopify customer (`customerUpdate`) to fill in a missing email/phone — the other half of `customer-create.ts`. Keeps their customer id, so orders and addresses stay attached. Maps "already been taken" to a `ConflictError` the signup form can act on, same as create. |
| `routes/index.ts`, `routes/otp_handlers.ts`, `routes/idp_handlers.ts`, `routes/capi_handlers.ts`, `routes/shared.ts`, `routes/schemas.ts` (see `routes/variables.md`) | The Hono routes: OTP send/verify/resend/details, the IdP endpoints (`/authorize`, `/token`, `/.well-known/*`, JWKS) if using the custom IdP, and the CAPI endpoints (`/capi/start`, `/capi/callback`, `/capi/claim`, `/capi/logout`, `/capi/checkout-grant` — mobile-app-only, mints a warm-up grant for an already-signed-in customer opening a checkout webview; see "Known gotchas"). |
| `email-domain.ts` | The one email-validation module: `isWellFormedEmail()` (shape, via `z.string().email()`) and `checkEmailDomain()` (live MX lookup). Used by the details handler and by the login gate. The MX check fails open on any timeout/resolver error — only a confirmed no-MX-records result rejects. |
| `middleware/customer.ts` | Route-gating middleware — resolves a `capi_sess_<uuid>` session id from the `Authorization: Bearer` header to a local customer. `requireCustomer` 401s when missing/invalid; `optionalCustomer` + `readOptionalCustomer` resolve the same credential without ever throwing, for a route that serves guests and signed-in shoppers from one handler (wishlist, PDP) — an invalid/expired token degrades to guest rather than 401ing a page that renders fine without auth. If your app also has some other login path issuing a different bearer-credential shape on the same header, branch on a prefix the same way this file's own comment describes — resolve each kind through its own function, cached under its own key prefix. |
| `repositories/customers.ts`, `customer_signup.ts` | Postgres upsert logic for the local `Customer` row, keyed by `shopifyId`, lazily backfilled from Shopify on a cache miss. |
| `repositories/idp_interactions.ts`, `idp_auth_codes.ts` | Redis-backed short-lived OIDC handshake state (custom-IdP path only). |
| `examples/using-call-with-capi-expiry.ts` | Not imported by anything — a reference showing `callWithCapiExpiry`'s two real usage shapes (throw vs. return-null) with the surrounding project-specific logic stripped out. Copy the pattern into your own handlers rather than importing this file. |

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

# Logout. Without BOTH of these, Shopify's own customer-account session survives
# your logout and silently hijacks the NEXT login — see "Shopify reuses its own
# session" below. Not optional in practice.
CAPI_END_SESSION_ENDPOINT=          # the read-only "Logout endpoint" on the Customer Account API screen
CAPI_POST_LOGOUT_REDIRECT_URI=      # where Shopify returns the browser after ending its session; ALSO paste
                                    # this exact value into the "Logout URI" field under Application setup,
                                    # or Shopify rejects the redirect

# Shared with the rest of your Shopify integration
SHOPIFY_ADMIN_API_TOKEN=
SHOPIFY_STORE_DOMAIN=
SHOPIFY_API_VERSION=

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
   `capi-idp/routes/capi_handlers.ts`'s CAPI callback handler + `capi/token_exchange.ts` take it from
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
   — read directly off Shopify's identity-provider settings page once you've registered. Include
   **every** post-logout target too: Shopify's front-channel logout calls your `/idp/logout` with a
   `post_logout_redirect_uri`, and since that allowlist is shared with `/authorize`'s check, a
   missing entry makes the handler fail closed and answer a bare "Logged out" instead of
   redirecting the customer back to your site.
5. **Fill in the "Logout URI" field** under Customer Account API → Application setup with the exact
   same value as `CAPI_POST_LOGOUT_REDIRECT_URI`. Shopify rejects the post-logout redirect
   otherwise. This field is empty by default, and because nothing calls the logout endpoint until
   you wire it up, it is easy to ship without ever hitting the rejection.
6. Do all of this **separately per environment** (dev/staging/prod each need their own Shopify
   registration and their own signing key, since each has a different domain).

## Known gotchas — already hit and fixed once; don't reintroduce them

- **Shopify reuses its own customer-account session, so a login can return the WRONG customer.**
  This is the single worst bug in this whole flow, and it needs three separate mechanisms to
  handle properly. `/oauth/authorize` takes no `prompt` parameter (Shopify documents only
  `locale` and `region_country` — `prompt=login` does nothing), so whenever Shopify already
  holds an authenticated customer-account session it **short-circuits**: it never calls your IdP,
  and it hands back an authorization code for *whoever it already had*, silently discarding the
  OTP you just verified. On a shared or kiosk browser the first person to log in owns every
  later login until that session expires.

  1. **Prevention — end Shopify's session on logout.** `capiLogoutHandler` returns a `logoutUrl`
     built from `CAPI_END_SESSION_ENDPOINT`, carrying the session's own persisted `id_token` as
     `id_token_hint`. Your frontend must do a **top-level navigation** to it, not a `fetch`:
     Shopify's session is a cookie in that browser, so nothing server-side can clear it, and a
     `Set-Cookie` on a cross-origin fetch is dropped. Shopify **rejects** `end_session_endpoint`
     without a valid `id_token_hint` ("Invalid id_token") rather than logging out anonymously —
     so a URL built without one doesn't merely skip the clean return trip, it leaves Shopify's
     session fully intact while looking like it worked.
  2. **Detection — carry the grant token and re-check it.** Put the single-use grant token on
     `PendingAuth` (`grantToken`) and consume it again in the callback. If it's **still
     unconsumed**, your IdP was never called, so this code came from a reused session. Note this
     proves only that Shopify skipped you — it says **nothing** about identity.
  3. **Judge identity, don't infer it.** Treating "grant unconsumed" as "wrong customer" is
     wrong and was itself a bug: signing in from Shopify's checkout leaves Shopify holding a
     session for the customer who *just* logged in, so an immediate second login short-circuits
     to the **same** person and was refused anyway. Exchange the code, resolve the actual
     customer (`getCapiCustomer`), and compare it to the one the grant was minted for. Same
     customer → let them in. Different → refuse, delete the just-minted session (it is a live
     30-day credential for the wrong customer), and redirect them through Shopify's logout using
     that session's `id_token` so their retry starts clean — refusing alone dead-ends them, since
     every retry short-circuits to the same wrong identity until Shopify's session expires.
     Compare ids on their numeric tail: the Customer Account API returns
     `gid://shopify/Customer/123` while your own row may hold the bare `123`, and a format
     difference must never read as a different person.
- **Never throw from the CAPI callback — redirect.** `capi/callback` is a top-level browser
  navigation, so anything thrown there renders raw JSON at the customer in the middle of logging
  in. Every failure on that route (Shopify-denied authorize, missing/replayed state, expired
  pending state, failed code exchange, identity mismatch) is recoverable by simply logging in
  again, so send them to your login page with a coarse notice instead. Two consequences worth
  planning for: the redirect means your `AppError` handler never sees these, so **report the
  genuine faults explicitly** (a missing config, a failed exchange) or you silently lose all
  alerting on them; and keep a `throw` as the last resort for when no login page URL is
  configured to redirect to.
- **The browser-binding secret must be mandatory, not optional.** The claim token returned by the
  callback is a bearer credential in a URL — whoever POSTs it gets the session. `bindSecret` is
  what proves the browser finishing the login is the one that started it: the browser mints a
  random secret in `sessionStorage`, sends only its SHA-256 up front, and returns the raw secret
  at claim time. If a missing recorded hash is allowed to *pass* (`if (!expectedHash) return
  true`), the whole control is bypassable by any caller that simply omits it — a relayed claim
  URL then logs the victim into the attacker's session, and since the callback clears any prior
  credential first, the attacker's wins outright. Refuse on a missing hash, and make the request
  field required. Also send the hash on **whichever call mints the grant** — for a returning
  customer that's `otp/verify`, but for a *signup* it's `otp/details` (verify answers
  `details_required` and mints nothing), so a hash sent only to verify is silently discarded and
  every new signup fails the claim.
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
  treating a single error as a conflict.
- **Every other `userErrors` case is a 400, not a 502.** A single non-"already taken" error (a
  malformed phone, an invalid email) is still client input Shopify rejected — not a dependency
  failure. Throwing a generic `UpstreamError` (502) there makes the client retry identically
  forever and pages on-call for what's really a typo. `customer-create.ts` routes this through
  `@devxcommerce/bff-core`'s `assertNoShopifyUserErrors`, which maps it to a `ValidationError`
  (400) instead — use the same helper (or your own equivalent mapping) rather than a blanket
  `UpstreamError` for anything that isn't the duplicate case above.
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
  point of having a separate per-identity limit at all. The reference numbers here are 5/hour +
  10/day per identity, 20/hour per IP (a ~4x ratio, matching the industry-standard 3-5/hour range
  for OTP sends) — the 30-second resend cooldown
  (`otp-engine`'s own challenge TTL logic) is the actual anti-pumping-fraud throttle; the
  hourly/daily counters are a looser backstop and shouldn't be what a customer trips over a slow
  SMS delivery.
- **The typed, unverified second field in a signup form (e.g. a phone typed during an
  email-channel signup) is never pre-checked against your DB or Shopify** — it's trusted as
  typed, and Shopify's own `customerCreate` uniqueness constraint is what catches a duplicate
  (atomically, avoiding a check-then-create race). This is a deliberate tradeoff, not an
  oversight — document it as an accepted risk in your own security notes if you keep this shape.
- **A hand-rolled email regex is not the same check Shopify's writes make.** `capi/customer.ts`
  and `capi-idp/routes/schemas.ts`'s email refine both need the SAME shape check `customerCreate`
  itself enforces, or you get a customer whose account looks fine to your code but whose email
  Shopify later rejects on a write (e.g. `cartBuyerIdentityUpdateByEmail` at checkout, if you
  build that flow) — silently, since that call is usually best-effort/degraded rather than
  user-facing. Use `z.string().email()` (or equivalent), not a loose `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
  — the loose version passes shapes (trailing/double dot, underscore or leading hyphen in the
  domain) that Shopify's own validator rejects.
- **Even a stricter shape check doesn't catch everything Shopify's live checks reject.**
  Confirmed empirically: some of Shopify's own mutations (`cartBuyerIdentityUpdate` specifically,
  if you build a cart/checkout integration) do live domain-deliverability checking — rejecting a
  syntactically valid address (an unusual TLD, a subdomain) that both a hand-rolled regex AND
  Zod's `.email()` accept. No static validation can pre-empt that; if you need to catch it
  earlier (e.g. at your own signup form), add a real MX lookup (`email-domain.ts` in this kit) —
  and make it fail OPEN on any timeout/resolver error, never reject on inconclusive. A cold
  lookup on a real, legitimate domain can take over a second (measured: over 1000ms uncached),
  so a timeout there is not evidence the domain is bad.
- **Mobile app checkout still needs Shopify's cookie planted in the checkout webview's own jar.**
  A native app's HTTP client and its checkout webview are separate cookie jars — logging in via
  your own HTTP-client-driven CAPI flow (this kit's `/capi/start` → `/capi/callback` → `/capi/claim`)
  never touches the webview's cookies at all. `routes/capi_handlers.ts`'s
  `capiCheckoutGrantHandler` (`POST /capi/checkout-grant`, gated behind `requireCustomer`) mints a
  fresh single-use grant for an already-signed-in customer; the app then opens
  `/capi/start?grant=...&return_to=<checkout URL>` INSIDE the checkout webview. `return_to` must
  be the actual checkout URL you want the webview to land on — it's validated against an exact
  host allowlist (`isAllowedReturnTo`, currently `SHOPIFY_STORE_DOMAIN` only; add your own custom
  checkout domain if you use one) and silently dropped (not refused) if it fails that check, so a
  bad value degrades to the normal post-login landing page rather than blocking the flow. On
  callback, this path never issues a session (none is needed for a warm-up) — it either redirects
  straight to `return_to` once identity is confirmed, or refuses with `capi_warmup_session_reused`
  if Shopify short-circuited to a reused session it can't verify belongs to this customer. Forgetting
  `return_to` (minting the grant but never passing it through `/capi/start`) means the redirect
  chain still plants the cookie, but the browser ends up on your normal login-landing page instead
  of checkout — the cookie is there, but the customer isn't where they expected to be.

## What to decide for your own project

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

## Open items — known gaps, deliberately unsolved

Not bugs, and not oversights — things this kit knowingly does not handle, so you can decide whether
your project needs to.

### Identifier collisions — measured, and not worth solving

Numbers below are a real `bulkOperationRunQuery` audit over every customer in the production store this
kit was extracted from (612,884 customers, 2026-08). Aggregates only — no per-customer data.

| Segment | Count | % of base |
|---|---|---|
| Real email on file | 611,794 | 99.82% |
| **No email at all** (what the gate collects from) | **1,080** | **0.18%** |
| Phone on file | 379,443 | 61.9% |
| **No phone at all** | **233,441** | **38.1%** |
| Phones shared by 2+ customer records | 13 pairs (26 customers) | 0.004% |
| **Emails shared by 2+ customer records** | **0** | **0%** |

**Zero shared emails out of 612,884.** Shopify blocks duplicate emails outright, which is exactly why a
colliding `customerUpdate` is *rejected* rather than silently merging — the platform is already doing
the integrity work. There is no corrupt-data scenario to defend against here.

**So who actually hits a collision?** Not the 0.18% the gate touches — that's the small side. The larger
exposure is the mirror case: a customer with an email but **no phone** (38.1%) who tries phone-OTP
login. The phone lookup finds nothing (Shopify has never seen that number), so they're routed to signup,
and then they type an email. Three outcomes:

| What they do | Outcome | Severity |
|---|---|---|
| Log in by **email** instead | Works normally — proven address, phone optional | **none** |
| Phone login, types their **existing** email | Blocked with `customer_email_taken` | friction only, data safe |
| Phone login, types a **new** email | Second account created, history stays on the first | the only real harm |

The harm case is `38.1% × (chose phone login) × (typed a different address than the one on their
account)` — two multiplicative filters, both well under 1. **In practice a fraction of a percent, and a
merge flow would not address it anyway**, because nothing errors: the customer simply created a new
account. That is why this kit ships no merge logic and no collision recovery beyond a clear error.

**The cheap mitigation, if you want one**, is UI-level and needs no new backend: when signup returns
`customer_email_taken`, don't just render the message — offer a one-tap switch to email OTP with that
address prefilled. Same information, but it finishes the journey. For the silent-duplicate row, the only
lever is the form itself: ask *"already shopped with us? sign in with your email"* **before** they type
a fresh address, not after.

**What changed vs. the deleted scheme.** `reconcileRealEmail` hit the same conflict in the background,
returned `'conflict'`, logged it, and moved on — nobody blocked, nobody's data fixed. Trading that
silent no-op for a loud, actionable stop is the intended change; just know it is a change.
