---
name: setup-tunnel
description: Use when the user wants to expose their local dev server(s) publicly via a Cloudflare tunnel — triggers on "set up tunnel", "/setup-tunnel", "let me share my local server", "give me a public link to my localhost". Writes this project's config INTO the repo so `./tunnel/run start`/`restart`/`stop` works for every teammate who clones it, not just the person who ran this skill — no manual engine install needed, `run` bootstraps it itself.
argument-hint: "(none needed — inspects the current project)"
user-invocable: true
disable-model-invocation: false
---

# Setup Tunnel

## Overview

This kit ships a generic, reusable `tunnel` engine that starts local service(s), tunnels each through
Cloudflare, and prints a public link. The engine itself knows nothing about this project — everything
project-specific lives in a small config file. This skill's job is to **write that config file, checked
into the repo**, by inspecting the current project, so the user never has to hand-write the bash
themselves — and so every teammate who clones the repo gets it working for free, not just the person
who ran this skill.

Split of responsibilities:
- **The engine** (`engine/tunnel` in this folder) — generic, has zero project-specific knowledge.
  Nobody needs to manually install it: `run` (below) bootstraps it to `~/.local/bin` on its own, the
  first time anyone invokes it on their machine.
- **`run`** — a committed bootstrap wrapper. `./tunnel/run start`/`restart`/`stop` is the command every
  teammate actually types; it auto-installs the engine on first use, then delegates to it.
- **The config** (`.tunnel.config.sh` at the project root) — project-specific, **committed to git**.
  Anyone who clones the repo can immediately run `./tunnel/run start` — no per-person setup, no skill
  re-run needed.

This is a one-time setup per project — whoever runs it first commits the whole `tunnel/` folder plus
`.tunnel.config.sh` for the rest of the team. Re-run it only if the project's shape changes (new
service, new ports, moved directories).

## Step 1 — Nothing to do here, `tunnel/run` handles prerequisites

You don't need to install the `tunnel` engine, `cloudflared`, or check for `python3` yourself —
`tunnel/run` (committed alongside this SKILL.md) does all of that automatically the first time
anyone invokes it, for every teammate, not just whoever runs this skill:
- Installs the engine to `~/.local/bin` if missing.
- Installs `cloudflared` via Homebrew if it's missing and `brew` is available (only asks nothing here
  because `run` itself prints exactly what it's doing before doing it — this isn't the skill silently
  installing something, it's the committed script being transparent about its own bootstrap).
- Checks for `python3` and stops with clear instructions if it's missing (doesn't attempt to install
  it — too platform-variable to guess safely).

So skip straight to Step 2.

## Step 2 — Inspect the project

Figure out, from the actual repo contents (don't ask the user anything you can determine yourself):

1. **Package manager**: look for `bun.lock`/`bun.lockb` → `bun`, `pnpm-lock.yaml` → `pnpm`,
   `yarn.lock` → `yarn`, else `package-lock.json` → `npm`.
2. **Shape**: is this a monorepo with multiple independently-runnable services (look for `apps/*` or
   `packages/*` each containing their own `package.json` with a `dev`/`start` script), or a single
   service at the repo root?
3. **Per service**, read its `package.json` `scripts` for `dev`, `build`, `start` — and its actual
   listening port. Check for a `PORT=` in its `.env`/`.env.example`, or infer the framework default
   (Next.js → 3000, Vite → 5173, Express apps commonly hardcode a port in source — grep for
   `.listen(` if nothing else surfaces it). **Never guess silently on a port** — if you can't determine
   it from the repo, ask the user directly rather than assuming.
4. **Framework dev-mode risk**: if a service is a frontend dev server (Next.js `next dev`, Vite `vite`,
   CRA, etc.) and is one of the services being tunneled for someone else to click around in, prefer
   wiring it to a **production build + start** instead of the dev server — dev-mode live-reload
   WebSockets don't survive free Cloudflare tunnels reliably, and when that breaks, hydration can fail
   *silently*: the page looks fine, but every click/drawer/button is dead. See `../README.md`'s
   "Why production mode" section for the full explanation if the user asks why. If the service is a
   pure backend/API (no client-side hydration to break), dev mode is fine.
5. **Cross-service wiring**: if there's more than one service, check whether the frontend's code
   references a client-exposed env var that points at the backend (grep for `NEXT_PUBLIC_`, `VITE_`,
   `REACT_APP_`, etc. followed by something like `_URL`, `_API`, `_BASE`, in the frontend's `.env*`
   files or a config/env-loading module). If found, note: the exact var name, which env file it lives
   in, and whether that same file has a "local" vs "staging"/"prod" toggle pattern to respect (don't
   blow away other environment blocks the user already has). Also check the backend for a CORS
   allowlist var (commonly `CORS_ALLOWED_ORIGINS`, `ALLOWED_ORIGINS`, or a `cors()` middleware call
   listing origins) that would need the frontend's tunnel origin added.
6. **Stale-cache risk**: if the backend has any caching layer (Redis, in-memory TTL cache, etc.) for
   data from an external upstream (a CMS, another API), ask the user (or check the code) whether "not
   found" results get cached without a short TTL — if so, a `post_tunnel_hook` should flush the
   relevant cache keys on every restart, the same way `../examples/web-and-backend.sh`'s commented-out
   `flush_backend_cache` does. Don't assume this applies — only add it if the project actually has this
   shape; most projects won't.
7. **Remote-upstream proxy risk**: only relevant if there's a local backend AND that backend's own env
   can point at either `localhost` or a real shared deployment (dev/UAT/staging) — check for a "local"
   vs "dev"/"uat" toggle in the backend's own config the same way you looked for one in step 5. If that
   pattern exists, the frontend WILL get silently CORS-blocked the moment someone points the backend's
   env at the remote deployment and tunnels the frontend — that remote deployment's CORS allowlist was
   fixed at its own deploy time and has never heard of an ephemeral tunnel URL. The fix is
   `scripts/bff-proxy.js` (ships with this kit, zero dependencies, runs under `node` or `bun`): scaffold
   `bff_local_upstream_url()` + a conditional `bff_start_cmd` exactly like `../examples/web-and-backend.sh`
   does, and branch `post_tunnel_hook` on whether it's running (see that example's `$BFF_UPSTREAM` check)
   since CORS-patching and cache-flushing are meaningless when the local backend is just a proxy. Read
   `../README.md`'s "Pointing a service at a remote upstream instead of running it locally" section for
   the full reasoning before wiring this. Don't add this complexity if the project has no such
   local/remote toggle — most single-environment backends won't need it.

If anything in steps 3–6 is genuinely ambiguous from the repo alone, ask the user — don't fabricate
plausible-looking values. A wrong port or wrong env-var name produces a config that silently fails
later, which is worse than a clarifying question now.

## Step 3 — Write the config

Base it on whichever example fits:
- **Single service** → `../examples/single-service.sh`
- **Multiple services with cross-wiring** → `../examples/web-and-backend.sh`
- **Multiple services, no wiring needed** (e.g. two independent APIs) → same shape as
  `single-service.sh`, just repeated per service in `SERVICES=(...)`, no `post_tunnel_hook`.

Fill in real values from Step 2 — real commands, real ports, real paths (using `$TUNNEL_PROJECT_DIR`
for anything relative to the project root, not a hardcoded absolute path, so the same config keeps
working for every teammate regardless of where they cloned the repo).

**Never put a secret directly in this file** (API keys, tokens, passwords) — it's going into git. If a
build/start command genuinely needs one, reference an env var the shell already has (`$SOME_TOKEN`),
don't inline the value.

Write the result to the **project root**, not `~/.config/tunnel/`:
```
$TUNNEL_PROJECT_DIR/.tunnel.config.sh
```
The `tunnel` engine checks for exactly this file — `./.tunnel.config.sh` in the directory you run
`tunnel` from — *before* falling back to a personal `~/.config/tunnel/<name>.sh`. Writing it here means
it ships with the repo: `git add .tunnel.config.sh`, commit it, and it's live for the whole team.

`chmod +x` the resulting file.

## Step 4 — Confirm, then offer to run it

Do a dry `bash -n .tunnel.config.sh` to catch syntax errors before declaring done. Then tell the user:

- The config is ready at `.tunnel.config.sh` — they should review it and commit it, **along with the
  rest of the `tunnel/` folder** (`git add tunnel .tunnel.config.sh`) if that folder isn't already
  committed, so teammates get both the engine and the config.
- Once that's pushed, anyone who pulls can just run `./tunnel/run start` — it bootstraps the engine on
  its own on first use, no manual install needed. That part only applies to *them*, though: this
  skill running once on your machine doesn't reach anyone else's — every teammate still runs
  `./tunnel/run start` themselves (or asks their own Claude session to), there's no way around a
  command needing to execute on the machine it affects.

Then **ask** whether they'd like you to run `./tunnel/run start` right now (don't just run it
unprompted — creating a public tunnel URL and launching long-lived background servers is exactly the
kind of action to confirm first). If they say yes, run it and report back the printed URLs. Still
don't `git add`/`git commit` the config or `tunnel/` folder yourself even if they say yes to running
it — staging/committing is a separate action they should trigger themselves.
