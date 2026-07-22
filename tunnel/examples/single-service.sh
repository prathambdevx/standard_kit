#!/usr/bin/env bash
# Example tunnel config — single service, no cross-URL wiring needed.
#
# Save as ~/.config/tunnel/<your-project-folder-name>.sh, then from that
# project's directory:
#   tunnel start

SERVICES=(app)

app_port=5000                      # whatever port your app listens on
app_start_cmd="node server.js"     # or `npm run start`, `python app.py`, etc.

# Optional — only add these if you actually need them:
# app_build_cmd="npm run build"                # if something needs building first
# app_ready_pattern="Listening on port"         # else the engine just polls the port
# app_kill_pattern="node dist/server.js"        # if killing by port alone doesn't work
