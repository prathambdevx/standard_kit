#!/usr/bin/env bash
# Example tunnel config — single service, no cross-URL wiring needed.
#
# Save as .tunnel.config.sh at your project root and commit it — that's
# what lets any teammate with the engine installed run `tunnel start` after
# pulling, no personal setup needed. (Only save it under
# ~/.config/tunnel/<project-folder-name>.sh instead if you deliberately want
# it to stay personal/uncommitted.)

SERVICES=(app)

app_port=5000                      # whatever port your app listens on
app_start_cmd="node server.js"     # or `npm run start`, `python app.py`, etc.

# Optional — only add these if you actually need them:
# app_build_cmd="npm run build"                # if something needs building first
# app_ready_pattern="Listening on port"         # else the engine just polls the port
# app_kill_pattern="node dist/server.js"        # if killing by port alone doesn't work
