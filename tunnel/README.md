# tunnel — local dev, tunneled

A generic multi-service local-dev + Cloudflare-tunnel orchestrator, plus a Claude Code skill that
scaffolds a project-specific config for it. Lets you run `tunnel start` in any project and get back
a public URL that actually works — including the client-side interactivity that a plain `next dev` +
tunnel combo silently breaks (see "Why production mode" below).

## What's in here

| Path | What it is |
|---|---|
| `engine/tunnel` | The generic engine — **install once, shared across every project.** Has zero project-specific knowledge; everything project-specific lives in a config file. |
| `setup-tunnel/SKILL.md` | A Claude Code skill: run it once in a new project and it writes that project's config file for you (detects package manager, ports, build/start commands, whether a client-env-var needs rewiring to a backend tunnel, etc). |
| `examples/` | Two config templates (single-service, and web+backend with cross-URL wiring) to read or copy by hand instead of running the skill. |

## Install (one-time, per machine)

```bash
mkdir -p ~/.local/bin
cp tunnel/engine/tunnel ~/.local/bin/tunnel
chmod +x ~/.local/bin/tunnel
```

Make sure `~/.local/bin` is on your `PATH` (add `export PATH="$HOME/.local/bin:$PATH"` to your
`.zshrc`/`.bashrc` if it isn't already). Requires [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
on `PATH` (`brew install cloudflared`) and `python3` (ships with macOS).

## Set up a new project

Two ways:

1. **Run the skill** — drop `setup-tunnel/SKILL.md` into that project's `.claude/skills/setup-tunnel/`,
   then ask Claude to run it (or `/setup-tunnel` if your harness supports invoking by folder name). It
   inspects the project and writes `~/.config/tunnel/<project-folder-name>.sh` for you.
2. **Copy a template by hand** — see `examples/single-service.sh` or `examples/web-and-backend.sh`,
   save as `~/.config/tunnel/<project-folder-name>.sh`, edit the commands/ports for real.

Either way, the config lands at `~/.config/tunnel/<project-folder-name>.sh` — the engine finds it
automatically by matching the directory name you run `tunnel` from. Nothing to pass on the command line.

## Use it

```bash
cd ~/code/whatever-project
tunnel start      # fresh tunnels — use for the very first run, or when you want new public URLs
tunnel restart    # same public URLs, servers restarted behind them (rebuilds/re-patches as configured)
tunnel stop        # tears everything down
```

Logs (one file per service, plus a `.build.log` and `.tunnel.log` per service) live at
`<project-root>/.tunnel/logs/` — inside the project, so they're visible in your editor's sidebar/search,
not off in `/tmp`. The engine auto-appends `.tunnel/` to that project's `.gitignore` the first time it
runs there (creating the file if needed), so none of it ever ends up staged by accident.

## Config file contract

```bash
SERVICES=(name1 name2 ...)             # order matters — started in this order

# For each name in SERVICES:
<name>_port=NNNN                       # required, EXCEPT: "web" defaults to 3000, "bff" defaults to
                                        #   4000 if omitted — any other service name always needs one
<name>_start_cmd="..."                 # required — command that starts it
<name>_build_cmd="..."                 # optional — run once before starting
<name>_ready_pattern="regex"           # optional — grep pattern in its log meaning "ready"
                                        #   (else the engine just polls until the port opens)
<name>_kill_pattern="pattern"          # optional — extra `pkill -f` pattern for stop/restart,
                                        #   for when killing by port alone doesn't reach the real
                                        #   process (e.g. a wrapper script spawning a child)

# Optional — runs once every service is up and tunneled:
post_tunnel_hook() { ... }
```

Inside the config and the hook:
- `$TUNNEL_PROJECT_DIR` — the directory `tunnel` was run from
- `$TUNNEL_URL_<NAME>` — public tunnel URL for each service (name uppercased, non-alnum → `_`)
- `run_build <name>` — helper: (re)runs `<name>_build_cmd` if set
- `restart_service <name>` — helper: kills + restarts `<name>` (tunnel itself untouched)

## Why production mode (for a frontend service)

`next dev` (or any framework's dev server relying on a live-reload WebSocket) can silently fail to
hydrate when tunneled through a free Cloudflare/serveo quick tunnel — the HMR socket's WebSocket
upgrade is exactly the kind of connection those tunnels handle worst. When it fails, the page can look
completely normal (server-rendered HTML loads fine) while every click, drawer, and accordion is dead —
React never attached event listeners to the real DOM. Production mode (`build` + `start`) has no such
socket, so it tunnels cleanly. If a service in your config is a frontend dev server, prefer wiring its
`_build_cmd`/`_start_cmd` to the production build, not the dev server, when the goal is sharing a public
link someone else will actually click around in.

## Why a service might need a rebuild mid-`tunnel start`

Frameworks like Next.js bake `NEXT_PUBLIC_*` (or similarly-prefixed client-exposed) env vars into the
JS bundle **at build time**, not read at server-start. If one service's tunnel URL needs to be wired
into another service's client-side env var (e.g. a frontend calling a backend that only exists at a
tunnel URL once tunneled), that frontend has to be *rebuilt* after the URL is known — a plain restart
won't pick up the change. This is exactly what `examples/web-and-backend.sh`'s `post_tunnel_hook` does:
patch the env, rebuild, then restart.
