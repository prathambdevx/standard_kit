# Tunnel Start Flow

> Developer runs `tunnel start`; the bootstrap wrapper makes sure the engine is installed and current, then the engine reads the project's own config, starts each service, tunnels it publicly, and runs any post-start wiring. A backend service can run as the real app (local upstream) or as a thin reverse proxy (remote upstream) — the config decides which, per session.

## At a glance — bootstrap + engine (same for both modes)

```
You            tunnel/run              ~/.local/bin/tunnel        .tunnel.config.sh
 │                  │                        │                          │
 ├─ tunnel start ──►│                         │                          │
 │                  ├─ ensure cloudflared ────┤                          │
 │                  ├─ ensure python3 ────────┤                          │
 │                  ├─ install/sync engine ──►│  (copy if missing/stale, │
 │                  │                         │   atomic temp+mv)       │
 │                  ├─ exec tunnel "$@" ──────►│                         │
 │                  │                         ├─ source config.tunnel ─►│
 │                  │                         ├─ source .tunnel.config.sh ►│
 │                  │                         │                         │  (SERVICES, ports,
 │                  │                         │                         │   bff_local_upstream_url())
 │                  │                         │                         │
 │                  │                         │        ── branches into ONE of the two flows below ──
```

## At a glance — local backend (no proxy)

```
.tunnel.config.sh        bff (real app)          Tunnel (cloudflared/ngrok)     Browser
       │                        │                          │                       │
       ├─ BFF_INTERNAL_URL is  │                          │                       │
       │  localhost/127.0.0.1  │                          │                       │
       ├─ start_service bff ──►│                          │                       │
       │                        ├─ listens on real port ──►│                       │
       │                        │                          ├─ tunnel opened ──────►│
       │                        │                          │                       │
       │◄─ post_tunnel_hook: patch_backend_cors + flush ───┤                       │
       │                        │◄─ restart_service bff ───┤                       │
       │                        │                          │                       │
       │                        │◄──────────── request ────────────────────────────┤
       │                        ├─ answers directly (real CORS_ALLOWED_ORIGINS) ───►│
```

## At a glance — remote upstream (proxy mode)

```
.tunnel.config.sh    bff-proxy.js (local)    Tunnel (cloudflared/ngrok)    Browser      Remote upstream (dev/UAT)
       │                     │                        │                       │                  │
       ├─ BFF_INTERNAL_URL  │                         │                       │                  │
       │  is a remote URL   │                         │                       │                  │
       ├─ start_service bff►│ (PROXY_UPSTREAM_URL=remote)                     │                  │
       │                     ├─ listens on same port ─►│                       │                  │
       │                     │                         ├─ tunnel opened ──────►│                  │
       │                     │                         │                       │                  │
       │◄─ post_tunnel_hook: skips CORS patch + flush ─┤ (proxy handles CORS itself, nothing to patch)
       │                     │                         │                       │                  │
       │                     │                         │◄──────── request ────┤                  │
       │                     │◄──────────────────────────────────────────────┤                  │
       │                     ├─ forwards server-to-server (no CORS restriction here) ────────────►│
       │                     │◄──────────────────────────────────────── response ─────────────────┤
       │                     ├─ answers with permissive CORS (reflects Origin) ─────────────────►│
```

## What kicks it off

A developer typing `tunnel start` (or `./tunnel/run start` the very first time, before the engine is on their `PATH`).

## Step by step

### 1. `tunnel/run` bootstraps prerequisites

`tunnel/run`

Checks for `cloudflared` (installs via Homebrew if missing) and `python3` (tells you how to install it if missing, doesn't attempt it — too platform-variable to guess).

**Why this step exists:** Nobody should have to manually set up dependencies before their first `tunnel start` works.

### 2. `tunnel/run` installs or re-syncs the engine

`tunnel/run`

Compares `tunnel/engine/tunnel` (committed in the repo) against `~/.local/bin/tunnel` (installed on this machine). Installs it if missing, re-syncs it if the contents differ or the installed copy lost its executable bit, does nothing if already current. The copy is atomic (temp file + `mv`), so a concurrent invocation never sees a half-written file.

**Why this step exists:** `git pull` updates the repo's copy of the engine, but nothing else ever touches the separately-installed copy in `~/.local/bin` — without this step, a fix landing in the repo would silently never reach anyone who already has the engine installed.

### 3. Control passes to the engine

`tunnel/run` → `tunnel/engine/tunnel`

Once the engine is confirmed current, `tunnel/run` hands off via `exec tunnel "$@"` (or runs `~/.local/bin/tunnel` directly, if `~/.local/bin` isn't on `PATH` yet).

**Why this step exists:** `tunnel/run` is a one-time bootstrap; the actual orchestration logic lives in one place (the engine), not duplicated in the wrapper.

### 4. The engine sources the project's config

`tunnel/engine/tunnel`

Finds `.tunnel.config.sh` at the project root (or a personal fallback in `~/.config/tunnel/`), sources the optional gitignored `config.tunnel` first (personal overrides like an ngrok domain), then sources `.tunnel.config.sh` itself — which defines `SERVICES`, each service's port/build/start command, and an optional `post_tunnel_hook`. This is also where the local-vs-proxy decision gets made, before any service starts.

**Why this step exists:** The engine has zero project-specific knowledge by design — everything about *this* project's shape, including which mode a backend runs in this session, lives in one file the project owns.

### 5. The backend's config decides: real app or proxy

`.tunnel.config.sh` — `bff_local_upstream_url()`

Reads the frontend's internal-backend-URL env var:

- **Points at `localhost`/`127.0.0.1`, or the file is missing (fresh clone)** → `bff_start_cmd` runs the real backend app, same as always. See "local backend (no proxy)" above.
- **Points anywhere else** (a shared dev/UAT deployment) → `bff_start_cmd` runs `tunnel/scripts/bff-proxy.js` instead, with `PROXY_UPSTREAM_URL` set to that remote URL. See "remote upstream (proxy mode)" above.

**Why this step exists:** A tunneled browser can only ever reach your local machine's tunnel origin — never a remote deployment's own (unrelated, fixed-at-deploy-time) CORS allowlist. Routing everything through the local tunnel, real app or proxy, is what makes both cases actually work from a shared link.

### 6. Each service is built, started, and tunneled

`tunnel/engine/tunnel`

For each name in `SERVICES`, in order: run its build command (aborting loudly if the build fails), start it and wait for it to actually respond, then open a public tunnel to its port (cloudflared by default, or ngrok for a persistent static domain) and wait for the tunnel URL to appear. This is identical regardless of which mode the backend is in — the engine doesn't know or care that one session's `bff` is a proxy and another's is the real app.

**Why this step exists:** Order matters when one service's tunnel URL needs to be known before another service builds (e.g. a frontend baking in its backend's public URL).

### 7. `post_tunnel_hook` wires services together — and skips what doesn't apply

`.tunnel.config.sh` (project-defined)

Once every service is up and tunneled, the project's own hook runs. In **local mode**, it patches the backend's CORS allowlist with the frontend's tunnel origin, flushes any local cache so no stale upstream data survives, and restarts the backend to pick both up. In **proxy mode**, it skips all three — the proxy answers every request with its own permissive CORS headers per-request (no static allowlist file to patch) and holds no local cache to flush, so patching or restarting would be pointless. Either way, the frontend's tunnel-facing env var is always patched to the **local** tunnel URL, never the remote one directly.

**Why this step exists:** Two independently-tunneled services can't know about each other's public URL until both exist — this hook is where that cross-wiring happens, after the fact, and only for whichever mode is actually relevant this session.

## Key files

| File | Role |
|---|---|
| `tunnel/run` | Bootstrap wrapper — installs/syncs deps + the engine, then delegates |
| `tunnel/engine/tunnel` | The generic engine — all start/stop/restart/build/tunnel logic |
| `tunnel/scripts/bff-proxy.js` | Generic reverse proxy — runs instead of the real backend app when `.tunnel.config.sh` decides this session needs one |
| `.tunnel.config.sh` | Project-specific config — committed, defines `SERVICES`, `bff_local_upstream_url()`, and hooks |
| `config.tunnel` | Personal, gitignored — e.g. your own ngrok static domain |
| `~/.local/bin/tunnel` | The installed engine binary — shared across every project on this machine |
| `.tunnel/logs/` | Per-service logs (repo-local, gitignored) — `<name>.log`, `<name>.build.log`, `<name>.tunnel.log` |
