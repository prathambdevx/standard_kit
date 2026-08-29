# Auth — variable reference

Quick lookup for the names that carry state through this OTP + custom-IdP + CAPI
flow. Handlers are split by category: `otp_handlers.ts` (your own API),
`idp_handlers.ts` (OIDC, Shopify is the client of you), `capi_handlers.ts`
(you are the client of Shopify).

Names below use this kit's defaults — rename the cookies and env vars to match
your own conventions when you drop it in.

## The two login paths

Both end with the customer holding a real Shopify session; they differ only in **who started the login**.

| Path | Started by | How it finishes |
| --- | --- | --- |
| **Path A** | The customer, on **your own login page** — the **normal login flow** | No interaction cookie exists, so there is nothing for Shopify to wait on. You mint a silent grant and return `capiHandoffUrl`; the browser navigates there and you run the CAPI handshake yourself. Response `status: 'verified'`. |
| **Path B** | **Shopify**, which redirected the browser to you (e.g. "Sign in" inside checkout hits `/idp/authorize` first) | The interaction cookie is present, so a pending OIDC interaction is waiting. You complete it and hand Shopify back a `redirectUrl`. Response `status: 'authenticated'`. |

`respondWithCustomerSession` (otp_handlers.ts) picks between them: interaction cookie present → Path B, else → Path A.

## Cookies

| Name | What it does |
| --- | --- |
| `idp_interaction` (`INTERACTION_COOKIE`) | Holds the pending OIDC interaction id after Shopify hits `/idp/authorize`. Its presence is what makes a login Path B. httpOnly, 10 min. |
| `idp_silent_grant` (`SILENT_GRANT_COOKIE`) | Carries the silent-grant token across the Shopify round trip so `/idp/authorize` can auto-complete instead of prompting for a second OTP. Set on the real top-level navigation to `capiHandoffUrl`, not on the cross-origin fetch. |

## Tokens and Redis records

| Name | What it does |
| --- | --- |
| `otpId` | Id of one OTP challenge row. Ties send → verify → details together. |
| **silent grant** — `idp_silent_<uuid>` | Single-use proof that this customer just passed OTP. Consumed by `authorizeHandler` to bind the right customer. 5 min TTL. |
| **pending** — keyed by `state` | Per-handshake state for the Shopify round trip: PKCE `codeVerifier`, `redirectUri`, `bindHash`, `grantToken`. 10 min TTL. |
| `state` | Random per-handshake id sent to Shopify and returned on the callback; the lookup key for the pending record above. |
| `codeVerifier` / `codeChallenge` | PKCE pair. The verifier stays server-side in the pending record; only the S256 challenge goes to Shopify. |
| **claim token** — `capi_claim_<uuid>` | Short-lived single-use stand-in for the real session id, so the id never rides in a redirect URL. Traded in a JSON body via `/capi/claim`. 5 min TTL. |
| **CAPI session id** — `capi_sess_<uuid>` | The real bearer credential, long-lived (no TTL — it lasts as long as Shopify honours the refresh token). Wraps Shopify's access token, refresh token and `idToken`. Only its sha256 is stored. |
| `idToken` | Shopify's id_token for the session. Required as `id_token_hint` on logout — Shopify rejects an end-session request without it. |
| `grantToken` | The silent-grant token, carried inside the pending record. Still unconsumed at callback time means Shopify skipped your IdP, which triggers the identity re-check. |

## Browser binding (anti-relay)

| Name | What it does |
| --- | --- |
| `x-bsc-bind-hash` | Request header the web app sends on verify; the sha256 recorded against the grant. Rename to your own prefix. |
| `bindSecret` | The raw secret the web app keeps in `sessionStorage` and sends in the `/capi/claim` body. |
| `bindHash` | The stored sha256, carried grant → pending → claim token. Compared at the claim step so a relayed sign-in URL can't drop a victim into the attacker's session. |

## Timing and limits

| Name | Value | What it does |
| --- | --- | --- |
| `OTP_TTL_MS` | 5 min | How long an OTP code stays valid. |
| `MAX_ATTEMPTS` | 5 | Wrong-code guesses allowed per challenge. |
| `RESEND_COOLDOWN_MS` | 30 s | Minimum gap between resends. |
| `PHONE_HOURLY_MAX` / `PHONE_DAILY_MAX` | 5 / 10 | OTP sends allowed per phone or email. |
| `IP_HOURLY_MAX` | 20 | OTP sends allowed per client IP (one IP is legitimately many people). |
| `VERIFY_IP_HOURLY_MAX` | 30 | Verify attempts per IP — bounds an attacker who keeps requesting fresh challenges. |
| `DETAILS_SUBMISSION_WINDOW_MS` | 5 min | How long after verifying you can still submit signup details. |
| `MAX_INTERACTION_TO_OTP_SEND_GAP_MS` | 30 s | Max gap between an `/authorize` hit and the OTP send it belongs to, so a stale interaction isn't treated as Path B. |
| `SILENT_GRANT_COOKIE_MAX_AGE_SECONDS` | 5 min | Cookie lifetime; must match `SILENT_GRANT_TTL_SECONDS` in the store. |

## Env vars

| Name | What it does |
| --- | --- |
| `OTP_HASH_SECRET` | HMAC key for hashing OTP codes at rest. Rotating it invalidates every in-flight code. |
| `IDP_CLIENT_ID` / `_SECRET` | Credentials **Shopify** uses to authenticate to your IdP. |
| `IDP_SIGNING_KEY` | RSA key your IdP signs id/access tokens with; published at `/idp/jwks`. |
| `IDP_ALLOWED_REDIRECT_URIS` | Exact-match allowlist for `/authorize` redirects (auth-code carrying — stays exact-match only). Post-logout redirects also accept this list, **plus** any trusted Shopify origin — see `CAPI_CUSTOMER_ACCOUNT_HOST` below. |
| `SHOPIFY_STORE_DOMAIN` | Your `<shop>.myshopify.com` domain — trusted as a post-logout redirect origin, since checkout's real sign-out callback lands there, not on the CAPI host. |
| `CAPI_CUSTOMER_ACCOUNT_HOST` | Shopify's `<shop>.account.myshopify.com` customer-accounts host — also trusted as a post-logout redirect origin. |
| `CAPI_CLIENT_ID` / `_SECRET` | Credentials **you** use as a client of Shopify's Customer Account API (mirror of the IdP pair). |
| `CAPI_AUTHORIZE_ENDPOINT` / `CAPI_TOKEN_ENDPOINT` | Shopify's OAuth endpoints. The token endpoint is where the authorization code is exchanged for a session. |
| `CAPI_REDIRECT_URI` | Your `/auth/capi/callback`, also registered on Shopify's side. |
| `CAPI_SCOPE` | Scopes requested from Shopify (`openid email customer-account-api:full`). |
| `CAPI_END_SESSION_ENDPOINT` | Shopify's logout endpoint, used to end Shopify's own session so the next login isn't silently reused. |
| `CAPI_POST_LOGOUT_REDIRECT_URI` | Where Shopify returns the browser after logout; must be registered with Shopify too. |
| `LOGIN_PAGE_URL` | Your login page — where `/idp/authorize` sends the browser, and the fallback for failed callbacks. |
| `CAPI_CALLBACK_LANDING_URL` | Frontend page the callback redirects to, carrying `capi_claim`. |
| `SYNTHETIC_EMAIL_DOMAIN` | Domain for placeholder emails on phone-only signups (Shopify requires an email). |

## Gotcha worth knowing

Shopify's `/oauth/authorize` **silently reuses an existing customer-account
session** — it never calls your IdP, and returns a code for whoever it already
had. That is why the callback re-checks identity after the exchange instead of
trusting the code, and why logout must call `end_session_endpoint` with
`id_token_hint`. Without both, a second login in the same browser can resolve
to the wrong customer.

**Checkout runs a silent `prompt=none` probe constantly** (Shopify's
`sso=silent` mechanism) — `/idp/authorize` must answer it with
`error=login_required` on the `redirect_uri`, never your login page. Getting
this wrong renders your OTP screen *inside* checkout on every silent check,
and completing it there signs the shopper back in right after they signed out.
