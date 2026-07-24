# Tunnel Start Flow

> Developer runs `tunnel start`; the bootstrap wrapper makes sure the engine is installed and current, then the engine reads the project's own config, starts each service, tunnels it publicly, and runs any post-start wiring.

## At a glance

```
You            tunnel/run              ~/.local/bin/tunnel        .tunnel.config.sh         Service + Tunnel
 │                  │                        │                          │                        │
 ├─ tunnel start ──►│                         │                          │                        │
 │                  ├─ ensure cloudflared ────┤                          │                        │
 │                  ├─ ensure python3 ────────┤                          │                        │
 │                  ├─ install/sync engine ──►│  (copy if missing/stale, │                        │
 │                  │                         │   atomic temp+mv)       │                        │
 │                  ├─ exec tunnel "$@" ──────►│                         │                        │
 │                  │                         ├─ source config.tunnel ─►│                         │
 │                  │                         ├─ source .tunnel.config.sh ►│                      │
 │                  │                         │                         │  (SERVICES, ports,      │
 │                  │                         │                         │   start cmds, hooks)    │
 │                  │                         ├─ run_build + start_service + tunnel_service ──────►│
 │                  │                         │                                        (per service, in order)
 │                  │                         ├─ post_tunnel_hook() ───►│                         │
 │                  │                         │                         │  (patch envs, flush cache)│
 │◄─── public tunnel URL(s) printed ──────────┤                         │                        │
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

Finds `.tunnel.config.sh` at the project root (or a personal fallback in `~/.config/tunnel/`), sources the optional gitignored `config.tunnel` first (personal overrides like an ngrok domain), then sources `.tunnel.config.sh` itself — which defines `SERVICES`, each service's port/build/start command, and an optional `post_tunnel_hook`.

**Why this step exists:** The engine has zero project-specific knowledge by design — everything about *this* project's shape lives in one file the project owns.

### 5. Each service is built, started, and tunneled

`tunnel/engine/tunnel`

For each name in `SERVICES`, in order: run its build command (aborting loudly if the build fails), start it and wait for it to actually respond, then open a public tunnel to its port (cloudflared by default, or ngrok for a persistent static domain) and wait for the tunnel URL to appear.

**Why this step exists:** Order matters when one service's tunnel URL needs to be known before another service builds (e.g. a frontend baking in its backend's public URL).

### 6. `post_tunnel_hook` wires services together

`.tunnel.config.sh` (project-defined)

Once every service is up and tunneled, the project's own hook runs — typically patching a frontend's env file with a backend's tunnel URL, patching a backend's CORS allowlist with the frontend's tunnel origin, and flushing any local cache so no stale upstream data survives the switch.

**Why this step exists:** Two independently-tunneled services can't know about each other's public URL until both exist — this hook is where that cross-wiring happens, after the fact.

## Key files

| File | Role |
|---|---|
| `tunnel/run` | Bootstrap wrapper — installs/syncs deps + the engine, then delegates |
| `tunnel/engine/tunnel` | The generic engine — all start/stop/restart/build/tunnel logic |
| `tunnel/scripts/bff-proxy.js` | Generic reverse proxy, used when a service's config points it at a remote upstream instead of running locally |
| `.tunnel.config.sh` | Project-specific config — committed, defines `SERVICES` and hooks |
| `config.tunnel` | Personal, gitignored — e.g. your own ngrok static domain |
| `~/.local/bin/tunnel` | The installed engine binary — shared across every project on this machine |
| `.tunnel/logs/` | Per-service logs (repo-local, gitignored) — `<name>.log`, `<name>.build.log`, `<name>.tunnel.log` |

## What can go wrong

- **A build fails but the service starts anyway with broken output** — shouldn't happen: the engine aborts immediately on a failed build and points at the exact build log. If you see this, your installed `~/.local/bin/tunnel` is stale (missing the fail-fast fix) — re-run `tunnel/run` to force a re-sync, or `cp tunnel/engine/tunnel ~/.local/bin/tunnel` manually.
- **`tunnel start` does nothing / reprints the same old URLs** — this is intentional idempotency: if every service is already up and its tunnel alive, `tunnel start` treats it as a no-op. Use `tunnel restart` to force a fresh restart behind the same links, or `tunnel stop` first for a truly clean start.
- **Frontend can't reach a backend pointed at a remote/shared deployment** — that remote deployment's CORS allowlist doesn't know your ephemeral tunnel origin. The fix is never to point the frontend at the remote URL directly — always patch it to the local tunnel origin and let `tunnel/scripts/bff-proxy.js` forward server-to-server instead (see `README.md`'s "Pointing a service at a remote upstream" section).
