---
name: wire-capi-auth
description: Use when the user wants OTP login and/or Shopify Customer Account API auth wired into their project from this kit — triggers on "set up capi-auth", "wire this auth into my project", "/wire-capi-auth", "add OTP login", "add the custom IdP". Copies and wires BOTH backend (BFF routes, IdP, OTP engine) and frontend (Zustand session stores, claim-token exchange) into the target project, then validates the result end to end instead of just reporting "done".
argument-hint: "(none needed — inspects the current project; ask only what genuinely can't be detected)"
user-invocable: true
disable-model-invocation: false
---

# Wire capi-auth

## Overview

`capi-auth/` (this kit's sibling folder to this skill) has two halves:
- **Backend** — `capi-idp/` (BFF routes, custom OIDC IdP, CAPI client, middleware) + `otp-engine/`
  (phone/email OTP send/verify/rate-limit). Documented in `../README.md`.
- **Frontend** — `capi-web/` (two Zustand session stores, the claim-token exchange, the
  auth-error-heals-itself pattern every write-through store needs). Documented in `../README.md`'s
  "Frontend wiring" section.

This skill's job: read `../README.md` in full (it is the actual spec — don't skip it and work from
memory of what auth kits usually look like), then execute what it describes as concrete file copies
and edits in the **target** project, and prove the result works before calling it done. The goal
stated by whoever asked for this: the target project's owner should not have to think about auth
at all, backend or frontend, once this skill finishes.

**Read `../README.md` and `../capi-idp/routes/variables.md` now, in full, before Step 1.** Every
env var, cookie name, and gotcha this skill checks for is defined there — this file does not
repeat that content, it tells you what to *do* with it.

## Step 1 — Detect the target project's shape

Don't ask the user anything you can determine yourself:

1. **Package manager** — `bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` →
   yarn, else `package-lock.json` → npm.
2. **Backend runtime** — is there a Bun + Hono BFF? Look for `hono` in a `package.json` and a
   `src/` shaped like routes/modules. If the target has no BFF at all, stop and ask whether one
   exists elsewhere (a separate repo) or needs scaffolding first — this skill wires *into* an
   existing BFF, it does not create one from scratch.
3. **Shared core package** — `../README.md`'s Prerequisites section names specific primitives
   (`AppError` subclasses, `cached()`, Shopify GraphQL helpers, a logger). Check whether the target
   has an equivalent. **If it doesn't, stop here and tell the user explicitly** — copying
   `capi-idp/` files as-is against raw `fetch`/`ioredis` with no adapter will silently produce
   broken imports throughout. Ask whether to (a) vendor a thin shim first, or (b) rewrite each
   import as the copy proceeds. Do not guess silently.
4. **Prisma present?** Check for `schema.prisma`. If missing, stop and ask — this skill adds two
   models to an existing schema, it does not set up Prisma from zero.
5. **Frontend framework** — Next.js (`next` in package.json) vs. another React setup vs. React
   Native. `capi-web/` itself is framework-agnostic; only the callback *route* and login *page*
   wiring differs by framework. Detect it so Step 4 places files correctly.
6. **Existing auth** — grep for anything already named `session`/`auth` in the target's store
   layer. If something already exists, ask before overwriting rather than silently colliding on a
   store name.

## Step 2 — Backend wiring

Follow `../README.md`'s "Setup steps (do these in order)" and "`otp-engine/` — files and env
vars" / "`capi-idp/` — files and env vars" sections exactly — this skill does not restate them.
Concretely, for the target project:

1. Copy `capi-idp/` and `otp-engine/` into the target's BFF source tree (mirror this kit's own
   internal folder shape unless the target's conventions clearly want otherwise — ask if unsure).
2. Rewrite every import that assumes the shared-core primitives from Step 1.3, if the target
   doesn't have an equivalent package.
3. Add the `Customer` + `CapiSession` Prisma models from the README's Prerequisites section to the
   target's `schema.prisma`. **Never silently alter an existing `Customer` model** — if one already
   exists, show the diff and ask before merging fields in. Generate the migration; do not apply it
   without the user's confirmation (this is a prod-adjacent schema change even in dev).
4. Add every env var this kit's code actually reads — cross-reference the list you get from:
   `grep -rhoE "env\.[A-Z_]+" capi-idp otp-engine | sort -u`
   (this is the authoritative list, not a hand-maintained one that can drift) — to the target's
   `.env.example` and its local `.env`. Never fill a real secret into `.env.example`; use a
   placeholder and tell the user which ones need real values (Shopify client id/secret, signing
   key, DB URL).
5. Mount the routes and middleware in the target's app entrypoint, matching how `capi-idp/routes/index.ts`
   is structured.
6. Point out the "Shopify-side setup" section's steps explicitly — these are the ones that need a
   human clicking through Shopify's admin (custom IdP registration, redirect URIs, the Logout URI
   field). **This skill cannot automate them.** Report them as a checklist for the user, not as
   done.

## Step 3 — Frontend wiring

1. Copy `capi-web/` into the target's shared client-side package/lib location (wherever it keeps
   cross-cutting state — ask if the target's own conventions don't make this obvious).
2. Wire storage: `window.localStorage` on web (with `memoryStorage()` for SSR — see
   `capi-web/storage.ts`'s own doc comment for the exact pattern), an injected MMKV-style adapter
   if the target is React Native.
3. Create the callback route in the target's actual routing convention (a Next.js route handler,
   a React Router loader, etc.) that calls `capi-web/capi_callback.ts`'s `exchangeCapiClaim()`.
   Reference `capi-web/examples/login_flow_example.tsx` for the shape, but build the target's own
   styled version — do not literally copy the example file into product code, it says so in its
   own header.
4. If the target already has write-through stores (cart, wishlist, saved addresses, anything that
   calls the BFF as a logged-in customer), wire `capi-web/heal_auth.ts`'s pattern into each one's
   catch block. If it has none yet, skip this — nothing to wire.
5. Wire `onAuthEdge()` (from `capi-web/commerce.ts`) for any store that needs to merge guest state
   on login / reset on logout, same pattern as bsc-platform's cart/wishlist stores (referenced in
   `../README.md`).

## Step 4 — Validate (do not skip; this is the actual point of running this skill)

Report a pass/fail checklist, not a narrative "looks good":

1. **Typecheck** the target project after all copies/edits. Any error here is a hard stop — fix it
   before reporting anything as done.
2. **Env var completeness** — re-run the `grep -rhoE "env\.[A-Z_]+"` extraction from Step 2.4
   against the target's actual copied files, diff against what's in `.env`/`.env.example`, and
   list anything still missing by exact name. Don't say "env vars configured" without having
   actually diffed the two lists.
3. **Backend boots** — if you can start the target's dev server, do so and hit:
   - `GET /.well-known/openid-configuration` (or wherever `discoveryHandler` is mounted) — expect
     a 200 with real endpoint URLs, not a 500 from a missing signing key.
   - `POST` the OTP send route with a test identity — expect a 200, not a 502/503 (503 means an
     env var or Redis connection is missing, per this kit's own error-code convention — see
     `../README.md`'s gotchas section on 502-vs-503).
   If you have no way to run the target's dev server in this environment, say so explicitly rather
   than silently skipping this check.
4. **Frontend imports cleanly** — confirm `capi-web/commerce.ts`'s `createAuthStores` and the two
   store files import without error from wherever you placed them, and that `useIsLoggedIn`/
   `useSessionHydrated` resolve to real hooks (not `undefined`) in the target's own module graph.
5. **Final summary** — a table: what was copied (file counts, not every path), what env vars still
   need real values filled in by a human, and the explicit list of Shopify-admin steps from Step
   2.6 that remain manual. Never claim "auth is fully wired" while that manual list is non-empty —
   say "code-complete; N manual Shopify-admin steps remain" instead.

## Common mistakes this skill exists to prevent

- Copying `capi-idp/` against a target with no shared-core package equivalent, producing silently
  broken imports nobody notices until runtime.
- Wiring only the backend (the actual gap this skill was written to close — a prior version of
  this kit had backend-only, so anyone using it had to hand-port the frontend half from scratch
  or copy it out of a completely different project).
- Making `bindSecret` optional anywhere in the frontend wiring — `../README.md` and
  `capi-web/bind_secret.ts`'s own doc comment both call this out explicitly as a security
  requirement, not a nice-to-have.
- Reporting "done" without actually running the Step 4 validation — a plausible-looking file copy
  is not the same as a project that boots and answers real requests correctly.
