#!/usr/bin/env bash
# Example tunnel config — a frontend that needs to know its backend's public
# tunnel URL (and a backend that needs to know the frontend's, for CORS).
# This is the shape bsc-platform uses (Next.js "web" + Bun/Hono "bff"), but
# nothing here is BSC-specific — adapt the paths/commands/env-var names to
# your own project.
#
# Save as .tunnel.config.sh at your project root and commit it — that's
# what lets any teammate with the engine installed run `tunnel start` after
# pulling, no personal setup needed. (Only save it under
# ~/.config/tunnel/<project-folder-name>.sh instead if you deliberately want
# it to stay personal/uncommitted.) Then, from the project's directory:
#   tunnel start      # fresh tunnel URLs
#   tunnel restart    # same URLs, servers restarted + re-patched behind them

SERVICES=(bff web)

# ---- Backend (adjust command/port/ready-pattern for your stack) -----------
bff_port=4000
bff_start_cmd="cd \"$TUNNEL_PROJECT_DIR/apps/bff\" && npm run dev"
bff_ready_pattern="listening"          # a string your backend logs once ready
bff_kill_pattern=""                    # only needed if port-kill isn't enough

# ---- Frontend — built + started in PRODUCTION mode -------------------------
# Dev-mode live-reload (webpack-hmr / Vite HMR / etc) relies on a WebSocket
# back to the dev server. Free Cloudflare/serveo quick tunnels are exactly the
# kind of thing that breaks WebSocket upgrades — when that socket can't
# connect, some frameworks' client hydration silently never completes: the
# page LOOKS fine (server-rendered HTML loads) but every click/drawer/button
# is dead, because the framework never attached real event listeners.
# Production mode has no such socket dependency, so it tunnels cleanly.
#
# web_build_cmd calls patch_frontend_env (defined below) BEFORE building —
# bff is always started/tunneled first (SERVICES order), so $TUNNEL_URL_BFF
# is already known by the time web builds. That means web only ever builds
# once, with the correct URL baked in from the start, instead of once with
# a stale value then again in post_tunnel_hook after patching.
web_port=3000
web_build_cmd="patch_frontend_env && cd \"$TUNNEL_PROJECT_DIR/apps/web\" && npm run build"
web_start_cmd="cd \"$TUNNEL_PROJECT_DIR/apps/web\" && npm run start"
web_ready_pattern="Ready|started"
web_kill_pattern=""
# Got a free persistent ngrok static domain (dashboard.ngrok.com/domains)?
# Set NGROK_DOMAIN="your-name.ngrok-free.app" in a git-ignored config.tunnel
# file at the project root (never commit that file — it's personal, tied to
# your own ngrok account) and this gives you the same public link every
# single run instead of a fresh random cloudflared one each time. Nobody has
# to do this — leaving it unset just falls back to cloudflared, same as
# always. See tunnel/README.md for the full walkthrough.
if [ -n "${NGROK_DOMAIN:-}" ]; then
  web_tunnel_provider="ngrok"
  web_ngrok_domain="$NGROK_DOMAIN"
fi

# ---- Wiring: frontend needs the backend's tunnel URL baked in --------------
# Whatever your framework's "public/client-exposed env var" prefix is
# (NEXT_PUBLIC_*, VITE_*, REACT_APP_*, ...), the browser can't reach
# `localhost:<port>` on the machine sharing the link — it needs the backend's
# actual tunnel URL. IMPORTANT: most frameworks bake these vars in at BUILD
# time, not read them at server start — so patching the env file only takes
# effect on the NEXT build, not a restart. That's why web_build_cmd above
# calls this directly, rather than patching afterward in post_tunnel_hook.
patch_frontend_env() {
  # Replace this with whatever your project's actual env file + var name is.
  # Example for a Next.js app using .env.local:
  python3 - "$TUNNEL_PROJECT_DIR/apps/web/.env.local" "$TUNNEL_URL_BFF" <<'PYEOF'
import re, sys
path, backend_url = sys.argv[1], sys.argv[2]
with open(path) as f:
    content = f.read()
content, n = re.subn(r"^NEXT_PUBLIC_API_URL=.*$", f"NEXT_PUBLIC_API_URL={backend_url}", content, flags=re.M)
if n == 0:
    content += f"\nNEXT_PUBLIC_API_URL={backend_url}\n"
with open(path, "w") as f:
    f.write(content)
PYEOF
}

# ---- Wiring: backend needs to allow the frontend's tunnel origin in CORS --
patch_backend_cors() {
  # Replace with wherever your backend's CORS allowlist actually lives
  # (an env var, a config file, a database row, whatever). Example assuming
  # a comma-separated CORS_ALLOWED_ORIGINS var in a .env file:
  python3 - "$TUNNEL_PROJECT_DIR/apps/bff/.env" "$TUNNEL_URL_WEB" <<'PYEOF'
import re, sys
path, frontend_url = sys.argv[1], sys.argv[2]
with open(path) as f:
    content = f.read()

def replace(m):
    origins = [o.strip() for o in m.group(1).split(",") if o.strip()]
    # Drop any previous tunnel origin — a random cloudflared one, or this
    # exact static ngrok domain from a prior run (a static domain would
    # otherwise just accumulate as an identical duplicate every restart).
    origins = [o for o in origins if not o.endswith(".trycloudflare.com") and o != frontend_url]
    origins.append(frontend_url)
    return "CORS_ALLOWED_ORIGINS=" + ",".join(origins)

content, n = re.subn(r"CORS_ALLOWED_ORIGINS=([^\n]*)", replace, content, count=1)
if n == 0:
    content += f"\nCORS_ALLOWED_ORIGINS={frontend_url}\n"
with open(path, "w") as f:
    f.write(content)
PYEOF
}

# ---- Optional: clear any backend cache that might be serving stale        -
# ---- data from before this tunnel session existed -------------------------
# Some backends cache upstream responses (Redis, in-memory, etc), keyed only
# by handle/id — not by which upstream instance/environment produced them. If
# you ever point the backend at a different upstream (a different CMS, a
# different store, a different API base URL) between tunnel sessions, cached
# entries from the PREVIOUS upstream keep being served indefinitely, since
# nothing about switching an env var invalidates them. Don't try to enumerate
# every cache key prefix by hand — that list grows and you will miss one.
# Simplest fix: just wipe the whole local dev cache DB on every tunnel
# session. It's a local dev instance, not shared/prod — there's nothing in it
# worth preserving across a restart, and a full flush guarantees no stale
# entry survives regardless of what gets cached under it later.
#
# flush_backend_cache() {
#   redis-cli -p 6379 flushdb > /dev/null 2>&1 || true
# }

post_tunnel_hook() {
  # Frontend env is already patched + baked in via web_build_cmd above —
  # bff comes first in SERVICES order, so its URL was already known before
  # web ever built. Only bff needs patching here, since it's the one whose
  # own build/start happened BEFORE web's tunnel URL existed.
  echo "  patching backend CORS allowlist with the frontend tunnel origin"
  patch_backend_cors

  # echo "  flushing stale backend cache"
  # flush_backend_cache

  echo "  restarting backend to pick up the new CORS origin"
  restart_service bff
}
