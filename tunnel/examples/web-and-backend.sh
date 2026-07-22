#!/usr/bin/env bash
# Example tunnel config — a frontend that needs to know its backend's public
# tunnel URL (and a backend that needs to know the frontend's, for CORS).
# This is the shape bsc-platform uses (Next.js "web" + Bun/Hono "bff"), but
# nothing here is BSC-specific — adapt the paths/commands/env-var names to
# your own project.
#
# Save as ~/.config/tunnel/<your-project-folder-name>.sh, then from that
# project's directory:
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
web_port=3000
web_build_cmd="cd \"$TUNNEL_PROJECT_DIR/apps/web\" && npm run build"
web_start_cmd="cd \"$TUNNEL_PROJECT_DIR/apps/web\" && npm run start"
web_ready_pattern="Ready|started"
web_kill_pattern=""

# ---- Wiring: frontend needs the backend's tunnel URL baked in --------------
# Whatever your framework's "public/client-exposed env var" prefix is
# (NEXT_PUBLIC_*, VITE_*, REACT_APP_*, ...), the browser can't reach
# `localhost:<port>` on the machine sharing the link — it needs the backend's
# actual tunnel URL. IMPORTANT: most frameworks bake these vars in at BUILD
# time, not read them at server start — so after patching the env file you
# must rebuild, not just restart. That's why this hook calls run_build.
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
    origins = [o for o in origins if not o.endswith(".trycloudflare.com")]
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
# ---- "not found" results from before this tunnel session existed ---------
# Some backends cache upstream responses (Redis, in-memory, etc). If a
# "not found" / null result ever gets cached without a short TTL, switching
# upstreams (or publishing content after an earlier miss) can leave the site
# rendering blank even though the real data now exists. If your backend has
# this shape, clear the relevant cache keys here. Example for a Redis-backed
# cache namespaced "mycache:*":
#
# flush_backend_cache() {
#   redis-cli -p 6379 --scan --pattern 'mycache:*' 2>/dev/null \
#     | xargs -r redis-cli -p 6379 del > /dev/null 2>&1 || true
# }

post_tunnel_hook() {
  echo "  patching frontend env with backend tunnel URL"
  patch_frontend_env

  echo "  rebuilding frontend (client-exposed env vars are baked in at build time)"
  run_build web
  restart_service web

  echo "  patching backend CORS allowlist with the frontend tunnel origin"
  patch_backend_cors

  # echo "  flushing stale backend cache"
  # flush_backend_cache

  echo "  restarting backend to pick up the new CORS origin"
  restart_service bff
}
