#!/usr/bin/env node
// Generic reverse proxy — engine-level tooling, not project-specific.
// Written against Node's built-in `http` module + global `fetch` only, so it
// runs unmodified under either `node bff-proxy.js` or `bun run bff-proxy.js`
// — no runtime-specific API (no Bun.serve), so adopting this pattern never
// forces a project onto a runtime it doesn't already use.
//
// Stands in for a local backend when that backend's real job right now is to
// forward to a remote upstream (uat/dev/whatever) instead of running its own
// logic. Why this exists: a tunneled frontend's browser-facing calls need
// SOME local origin whose CORS allowlist the tunnel script can patch every
// session — the real remote upstream's CORS allowlist is fixed at deploy
// time and has no idea about an ephemeral tunnel URL that changes every
// `tunnel start`. This proxy always runs on the local backend's usual port,
// stays fully patchable, and simply forwards every request to the real
// upstream server-to-server (no CORS restriction applies there at all — CORS
// is a browser-enforced policy for cross-origin requests, not a
// server-to-server one), then answers the browser with its own permissive
// CORS headers.
//
// Config via env vars (set by the project's own tunnel config, not here):
//   PORT                 required — port to listen on (same port the real
//                         backend would use)
//   PROXY_UPSTREAM_URL    required — base URL to forward every request to

import http from 'node:http';

const PORT = Number(process.env.PORT || '');
const UPSTREAM = process.env.PROXY_UPSTREAM_URL;

if (!PORT) {
  console.error('bff-proxy: PORT is not set.');
  process.exit(1);
}
if (!UPSTREAM) {
  console.error('bff-proxy: PROXY_UPSTREAM_URL is not set — nothing to forward to.');
  process.exit(1);
}

// Headers that only make sense hop-by-hop and must never be forwarded
// verbatim (either the runtime sets them itself, or they'd break the next
// hop's own transport framing).
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'] ?? '*';

  // Answer preflight directly — the real upstream never needs to see it,
  // and its own CORS response (if any) wouldn't match this tunnel origin.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': req.headers['access-control-request-method'] ?? '*',
      'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
    });
    res.end();
    return;
  }

  const target = new URL(req.url, UPSTREAM);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase()) || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }

  // Buffer the body — http.IncomingMessage is a Node stream, and fetch()
  // wants a Buffer/string/ReadableStream. Buffering keeps this one
  // implementation portable across Node and Bun without relying on
  // runtime-specific stream conversion. Fine for a dev proxy's typical
  // JSON/form payloads; a genuinely huge upload would want real streaming,
  // which is out of scope here.
  let body;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });
  } catch (err) {
    console.error(`bff-proxy: upstream fetch failed for ${target}: ${err}`);
    res.writeHead(502, {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
    });
    res.end(JSON.stringify({ error: 'upstream_unreachable', upstream: UPSTREAM }));
    return;
  }

  const resHeaders = {};
  upstreamRes.headers.forEach((value, key) => {
    // The upstream's content-encoding/content-length describe ITS response
    // body, but this process re-frames the body as it passes through — stale
    // values here would make the browser mis-decode or truncate it.
    if (key === 'content-encoding' || key === 'content-length') return;
    resHeaders[key] = value;
  });
  // Multiple Set-Cookie headers get folded into one comma-joined string by
  // the loop above (Headers.forEach can't distinguish repeats) — restore
  // them as a real array when the runtime exposes getSetCookie().
  if (typeof upstreamRes.headers.getSetCookie === 'function') {
    const cookies = upstreamRes.headers.getSetCookie();
    if (cookies.length > 0) resHeaders['set-cookie'] = cookies;
  }
  resHeaders['access-control-allow-origin'] = origin;
  resHeaders['access-control-allow-credentials'] = 'true';

  const responseBody = Buffer.from(await upstreamRes.arrayBuffer());
  res.writeHead(upstreamRes.status, resHeaders);
  res.end(responseBody);
});

server.listen(PORT, () => {
  console.log(`bff-proxy listening on :${PORT}, forwarding every request to ${UPSTREAM}`);
});
