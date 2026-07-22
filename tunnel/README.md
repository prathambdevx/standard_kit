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
5. Run:
   ```bash
   ./tunnel/run start      # first ever run on this machine — installs the engine, then starts
   ```

**Everyone else** (once the folder is committed): just `git pull`, then the same first command —
```bash
./tunnel/run start
```

**That `./tunnel/run` prefix is only needed once per machine** — the very first time, because the
plain `tunnel` command doesn't exist on your `PATH` yet and `./tunnel/run` is what installs it (see
"How it works" below for exactly what it does). After that one run, `tunnel` is a real installed
command like any other, and every future session — this project or any other — just uses the plain
form, no `./tunnel/run`, no path prefix:
```bash
tunnel start      # fresh public links (whenever you want new ones)
tunnel restart    # same public links as last time, servers restarted behind them
tunnel stop        # shuts everything down
```

**Tired of the public link changing every single run?** Cloudflare's free quick tunnels always give
you a new random URL — but [ngrok's free tier](https://dashboard.ngrok.com/domains) includes one
persistent static domain per account, and this kit supports it. Sign up free, claim your static
domain from the ngrok dashboard, run `ngrok config add-authtoken <token>` once, then create a
`config.tunnel` file at your project root (**never committed** — the engine auto-adds it to
`.gitignore`) with just one line:
```bash
NGROK_DOMAIN="your-name.ngrok-free.app"
```
That's it — the same link every single time you run `tunnel start`/`restart`, instead of a fresh
random one. Delete the file (or leave `NGROK_DOMAIN` unset) to fall back to the default random
cloudflared link. This is entirely personal/optional — whether it does anything at all depends on the
project's own `.tunnel.config.sh` actually checking for `$NGROK_DOMAIN` (see
`examples/web-and-backend.sh` for the pattern) — the engine itself has no opinion on it, it just makes
sure `config.tunnel` gets read before the shared config, if it exists.

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
This also needs [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
and `python3` — `./tunnel/run` checks for both and installs `cloudflared` for you automatically via
Homebrew if it's missing and `brew` is available (prints exactly what it's doing, doesn't do it
silently). If Homebrew isn't available, or `python3` is missing (rare — it ships with macOS by
default), it tells you exactly what to run instead and stops, rather than guessing at a platform-
specific install command for you.

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
./tunnel/run start      # idempotent — see below
./tunnel/run restart    # same public URLs, servers restarted behind them (rebuilds/re-patches as configured)
./tunnel/run stop        # tears everything down
```

**`start` is safe to run repeatedly.** If every service is already up (its port bound *and* its tunnel
alive), it changes nothing and just re-prints the existing links — no restart, no rebuild, no new
URLs. Only if something's actually not running does it do a full stop-then-start with fresh tunnel
URLs. So you never have to remember "is it already running?" before typing `start` — it just tells you.

(If you installed the plain `tunnel` command onto your `PATH` per the Install section above, `tunnel
start` / `restart` / `stop` work identically — `run` is just a thin, self-installing wrapper around the
exact same engine.)

Logs (one file per service, plus a `.build.log` and `.tunnel.log` per service) live at
`<project-root>/.tunnel/logs/` — inside the project, so they're visible in your editor's sidebar/search,
not off in `/tmp`. The engine auto-appends `.tunnel/` to that project's `.gitignore` the first time it
runs there (creating the file if needed), so none of it ever ends up staged by accident.

Two things the engine does to keep those logs actually readable:
- **Real-time, not bursty.** Most runtimes fully-buffer stdout the moment it's not a real terminal
  (which redirecting to a file counts as) — logs would otherwise arrive in delayed chunks instead of
  as they're emitted. The engine fakes a pseudo-terminal (via `script`) around each service's start
  command specifically to keep it line-buffered, so `tail -f` on these logs reflects what's actually
  happening as it happens. (Falls back to plain, possibly-bursty output if run somewhere with no real
  controlling terminal to fake one from, e.g. CI — it won't hard-fail there.)
- **Plain text, not ANSI garbage.** Loggers that colorize their terminal output (common — pino,
  most CLIs) leave raw escape codes in the file when redirected, which render as unreadable noise in
  an editor. The engine strips them before writing.

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
