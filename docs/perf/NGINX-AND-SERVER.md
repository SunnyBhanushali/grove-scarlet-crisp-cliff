# APMS p0as83 — nginx and server settings (note for the deploy bot)

These are recommendations; nothing in the app assumes any of them is on. Check
each against the live config before changing it.

## 1. nginx (in front of the one Node process)

```nginx
# HTTP/2: a browser keeps at most 6 HTTP/1.1 connections per host and every
# APMS tab holds one for its live stream; with HTTP/2 everything shares one.
listen 443 ssl http2;

upstream apms_app {
    server 127.0.0.1:3000;          # the PM2 / node-server port on live
    keepalive 64;                   # reuse upstream connections
    keepalive_timeout 4s;           # below Node's 5 s keep-alive: no "upstream prematurely closed"
}

# Compression. The app already gzips /api/company and the list reads it
# caches (content-encoding set → nginx passes them through); this covers the
# JS/CSS bundles (~2 MB uncompressed on a cold load) and every other JSON reply.
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_proxied any;
gzip_vary on;
gzip_types application/json application/javascript text/javascript text/css image/svg+xml text/plain;
# If the brotli module is installed (ngx_brotli), add:
# brotli on; brotli_comp_level 5; brotli_types application/json application/javascript text/javascript text/css image/svg+xml;

location / {
    proxy_pass http://apms_app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

# The live stream: never buffered, long-lived. (The app also sends
# X-Accel-Buffering: no.) PERF p0as83 pushes the change feed on it, so a
# buffered stream would make other users' saves arrive late.
location = /api/company-live {
    proxy_pass http://apms_app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    gzip off;
}

# Stamped assets are immutable (the app already sends
# Cache-Control: public, max-age=31536000, immutable). Serving them straight
# from disk takes that work off Node:
location /assets/ {
    root /path/to/app/.output/public;     # adjust
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri @app;
}
location @app { proxy_pass http://apms_app; proxy_http_version 1.1; proxy_set_header Connection ""; }
```

`worker_connections` should be at least 4096 (250 users × a live stream and a
few requests each, doubled for the upstream side).

## 2. Node / PM2

- **One process is enough for 250 users** after p0as83 (CPU p50 ≈ 40 % of one
  core at 250 simulated users; see REPORT-PERF.md). Keep PM2 in fork mode with
  one instance. Do **not** switch to cluster mode: live updates and the wire
  copy are per process; running several workers needs the cross-worker work
  described in REPORT-PERF.md §6 first.
- `node --max-old-space-size=2048` (RSS stayed ≈ 1.0 GB at 250 users).
- `max_memory_restart: "1800M"` as a safety net.

## 3. Postgres

Not the bottleneck (≤ 30 % of one core, ≤ 14 connections at 250 users).
Defaults are fine; `shared_buffers = 256MB` or more if the VPS has ≥ 4 GB RAM.
`pg_stat_statements` is useful for the next measurement.

## 4. After the cut

Every browser signs in once after the cut (BATCH-2 note). The SPA picks up
`apms-sync.js?v=p0as83` from the HTML; a hard refresh is not needed.
