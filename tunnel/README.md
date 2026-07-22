# tunnel — local dev, tunneled

Turns your local dev server(s) into a public link someone else can actually click around in — no
deploy needed.

**One person on the team does this, once, per project — everyone else skips straight to "everyone
else" below.**

**Whoever sets it up first:**

1. Point your local **web** app's env at your local **BFF/backend** (i.e. run both locally, wired to
   each other — `localhost:3000` talking to `localhost:4000`, or whatever your ports are).
2. Point your local **BFF/backend**'s own env at whichever upstream you want it to use (your dev
   Shopify store, your UAT Strapi, prod, whatever — this tool doesn't touch that choice, it just
   publishes whatever you've already got running).
3. Drop this whole `tunnel/` folder into the repo and ask Claude to run `setup-tunnel/SKILL.md` —
   once. It writes `.tunnel.config.sh` at the project root.
4. **Commit and push the whole `tunnel/` folder + `.tunnel.config.sh`.** This is the step that makes
   it a team thing, not a personal one — from here on, anyone who pulls this gets `tunnel start`
   working with zero manual setup, via `./tunnel/run` (see below).
5. Run one of:
   ```bash
   ./tunnel/run start      # fresh public links (first run, or whenever you want new ones)
   ./tunnel/run restart    # same public links as last time, servers restarted behind them
   ./tunnel/run stop        # shuts everything down
   ```

**Everyone else** (once the folder is committed): just `git pull`, then run the exact same commands —
```bash
./tunnel/run start
```
`./tunnel/run` is a committed bootstrap wrapper — the first time anyone runs it on their machine, it
installs the shared engine to `~/.local/bin` automatically (no manual copy/chmod needed); every run
after that (first-timer or not) it just delegates straight to it. Nothing to install by hand, nothing
project-specific to set up personally — `git pull` really is the whole story now.

Everything below is how it works under the hood, only useful if something needs debugging or you're
adapting it for an unusual project shape.

## How it works

A generic multi-service local-dev + Cloudflare-tunnel orchestrator, plus a Claude Code skill that
scaffolds a project-specific config for it. Lets you run `tunnel start` in any project and get back
a public URL that actually works — including the client-side interactivity that a plain `next dev` +
tunnel combo silently breaks (see "Why production mode" below).

### What's in here

| Path | What it is |
|---|---|
| `run` | **The one file teammates need to know about.** A committed bootstrap wrapper — auto-installs the engine to `~/.local/bin` the first time anyone runs it, then delegates to it. `./tunnel/run start` always works, whether it's your first time or your hundredth. |
| `engine/tunnel` | The generic engine — has zero project-specific knowledge; everything project-specific lives in a config file. You normally never call this directly — `run` does it for you. |
| `setup-tunnel/SKILL.md` | A Claude Code skill: run it once in a new project and it writes that project's config file for you (detects package manager, ports, build/start commands, whether a client-env-var needs rewiring to a backend tunnel, etc). Needs the rest of this `tunnel/` folder alongside it (it copies `../engine/tunnel` for you) — don't lift just the SKILL.md file out on its own. |
| `examples/` | Two config templates (single-service, and web+backend with cross-URL wiring) to read or copy by hand instead of running the skill. |

### Install

Nothing to install by hand under normal use — `./tunnel/run <command>` bootstraps the engine to
`~/.local/bin` on its own the first time it's run (see the `run` row above). It'll tell you if
`~/.local/bin` isn't on your `PATH` and needs adding to your shell profile, and still works for that
one invocation regardless.

If you'd rather install the plain `tunnel` command onto your `PATH` yourself (so you can type `tunnel
start` instead of `./tunnel/run start`, useful once you're using this across several projects):
```bash
mkdir -p ~/.local/bin
cp tunnel/engine/tunnel ~/.local/bin/tunnel
chmod +x ~/.local/bin/tunnel
```
Either way, this also requires [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
on `PATH` (`brew install cloudflared`) and `python3` (ships with macOS) — those aren't things a script
can safely install for you unasked, so make sure they're there first.

### Set up a new project

Two ways:

1. **Run the skill** (recommended) — with the whole `tunnel/` folder present in (or copied into) the
   new repo, ask Claude to run `setup-tunnel/SKILL.md`. It installs the engine if missing, inspects the
   project, and writes `.tunnel.config.sh` **at the project root**. It does *not* run `tunnel start` or
   `git commit` itself — both are left for you to trigger.
2. **Copy a template by hand** — see `examples/single-service.sh` or `examples/web-and-backend.sh`,
   save as `.tunnel.config.sh` at the project root, edit the commands/ports for real.

Either way: **commit `.tunnel.config.sh`** once it's right. That's what makes this a one-time,
whole-team setup instead of something every developer redoes on their own machine — the engine looks
for exactly this file (`./.tunnel.config.sh` in whatever directory you run `tunnel` from) before
falling back to a personal `~/.config/tunnel/<project-folder-name>.sh`, so a committed in-repo config
always wins. Nothing to pass on the command line, and nothing per-person to configure once it's
committed.

### Use it

```bash
cd ~/code/whatever-project
./tunnel/run start      # fresh tunnels — first run, or whenever you want new public URLs
./tunnel/run restart    # same public URLs, servers restarted behind them (rebuilds/re-patches as configured)
./tunnel/run stop        # tears everything down
```

(If you installed the plain `tunnel` command onto your `PATH` per the Install section above, `tunnel
start` / `restart` / `stop` work identically — `run` is just a thin, self-installing wrapper around the
exact same engine.)

Logs (one file per service, plus a `.build.log` and `.tunnel.log` per service) live at
`<project-root>/.tunnel/logs/` — inside the project, so they're visible in your editor's sidebar/search,
not off in `/tmp`. The engine auto-appends `.tunnel/` to that project's `.gitignore` the first time it
runs there (creating the file if needed), so none of it ever ends up staged by accident.

### Config file contract

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

### Why production mode (for a frontend service)

`next dev` (or any framework's dev server relying on a live-reload WebSocket) can silently fail to
hydrate when tunneled through a free Cloudflare/serveo quick tunnel — the HMR socket's WebSocket
upgrade is exactly the kind of connection those tunnels handle worst. When it fails, the page can look
completely normal (server-rendered HTML loads fine) while every click, drawer, and accordion is dead —
React never attached event listeners to the real DOM. Production mode (`build` + `start`) has no such
socket, so it tunnels cleanly. If a service in your config is a frontend dev server, prefer wiring its
`_build_cmd`/`_start_cmd` to the production build, not the dev server, when the goal is sharing a public
link someone else will actually click around in.

### Why a service might need a rebuild mid-`tunnel start`

Frameworks like Next.js bake `NEXT_PUBLIC_*` (or similarly-prefixed client-exposed) env vars into the
JS bundle **at build time**, not read at server-start. If one service's tunnel URL needs to be wired
into another service's client-side env var (e.g. a frontend calling a backend that only exists at a
tunnel URL once tunneled), that frontend has to be *rebuilt* after the URL is known — a plain restart
won't pick up the change. This is exactly what `examples/web-and-backend.sh`'s `post_tunnel_hook` does:
patch the env, rebuild, then restart.
