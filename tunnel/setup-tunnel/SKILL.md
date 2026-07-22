---
name: setup-tunnel
description: Use when the user wants to expose their local dev server(s) publicly via a Cloudflare tunnel — triggers on "set up tunnel", "/setup-tunnel", "let me share my local server", "give me a public link to my localhost". Installs the shared `tunnel` engine if missing and writes this project's config file so `tunnel start`/`restart`/`stop` works from here on.
argument-hint: "(none needed — inspects the current project)"
user-invocable: true
disable-model-invocation: false
---

# Setup Tunnel

## Overview

This project ships with a generic, reusable `tunnel` engine (one shared script, installed once per
machine) that starts local service(s), tunnels each through Cloudflare, and prints a public link. The
engine itself knows nothing about this project — everything project-specific lives in a small config
file. This skill's job is to **write that config file** by inspecting the current project, so the user
never has to hand-write the bash themselves.

This is a one-time setup per project. Once the config exists, the user just runs `tunnel start` /
`tunnel restart` / `tunnel stop` from the project root forever after — this skill doesn't need to run
again unless the project's shape changes (new service, new ports, moved directories).

## Step 1 — Install the engine, if missing

```bash
ls ~/.local/bin/tunnel 2>/dev/null && echo "already installed" || echo "needs install"
```

If missing, find this skill's sibling `../engine/tunnel` file (in the same kit checkout this SKILL.md
came from) and install it:

```bash
mkdir -p ~/.local/bin
cp <path-to-kit>/tunnel/engine/tunnel ~/.local/bin/tunnel
chmod +x ~/.local/bin/tunnel
```

Then confirm `~/.local/bin` is on `PATH` (check `echo $PATH`). If it isn't, tell the user to add
`export PATH="$HOME/.local/bin:$PATH"` to their shell profile (`.zshrc`/`.bashrc`) — don't silently skip
this, an uninstalled PATH means `tunnel` won't be found later.

Also confirm `cloudflared` is on `PATH` (`which cloudflared`). If missing, tell the user to install it
(`brew install cloudflared` on macOS) before continuing — don't try to install it yourself without
asking, it's a system-level package manager action.

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
for anything relative to the project root, not a hardcoded absolute path, since the same config should
keep working if the user clones the repo somewhere else).

Write the result to:
```
~/.config/tunnel/<basename of the current project directory>.sh
```
(This is exactly how the `tunnel` engine finds it later — by matching the directory name you run
`tunnel` from. No further wiring needed.)

`chmod +x` the resulting file.

## Step 4 — Confirm

Do a dry `bash -n ~/.config/tunnel/<name>.sh` to catch syntax errors before declaring done. Then tell
the user the config is ready and they can run:
```bash
tunnel start
```
from the project root. Don't run `tunnel start` yourself unless the user asks you to — creating public
tunnel URLs and running long-lived background servers is exactly the kind of action to let the user
trigger themselves, per this project's usual "confirm before acting" norms.
