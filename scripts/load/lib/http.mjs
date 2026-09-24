/**
 * PERF load runner — HTTP client for one simulated user (VU).
 *
 * A browser keeps at most 6 HTTP/1.1 connections per origin; each VU gets its
 * own keep-alive agent with the same limit, so a VU's requests queue behind
 * its own slow ones exactly as a tab's do. Every request is timed and its
 * status / size recorded under a route name.
 */
import http from "node:http";
import { gunzipSync } from "node:zlib";

export class Metrics {
  constructor() {
    this.routes = new Map(); // name -> { ms: [], bytes: [], status: {} }
    this.errors = [];
    this.events = []; // free-form (save marks, observations, raw checks)
  }
  record(name, ms, status, bytes) {
    let r = this.routes.get(name);
    if (!r) this.routes.set(name, (r = { ms: [], bytes: [], status: {} }));
    r.ms.push(Math.round(ms));
    r.bytes.push(bytes || 0);
    r.status[status] = (r.status[status] || 0) + 1;
  }
  error(name, detail) {
    if (this.errors.length < 2000) this.errors.push({ t: Date.now(), name, detail: String(detail).slice(0, 300) });
  }
  toJSON() {
    const routes = {};
    for (const [k, v] of this.routes) routes[k] = v;
    return { routes, errors: this.errors, events: this.events };
  }
}

export class Client {
  constructor(base, metrics, { maxSockets = 6, timeoutMs = 60000 } = {}) {
    const u = new URL(base);
    this.host = u.hostname;
    this.port = Number(u.port || 80);
    this.metrics = metrics;
    this.agent = new http.Agent({ keepAlive: true, maxSockets, keepAliveMsecs: 5000 });
    this.token = null;
    this.timeoutMs = timeoutMs;
    this.closed = false;
  }

  headers(extra = {}) {
    const h = { "accept-encoding": "gzip", ...extra };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Resolves { status, body (string|Buffer), json(), ms, headers }. Never throws (status 0 on network error).
   * A keep-alive socket the server closed while the request was being sent
   * (ECONNRESET / "socket hang up" before any response) is retried once on a
   * fresh socket, as browsers do; PATCH bodies carry a clientOpId, so a retry is
   * de-duplicated by the server.
   */
  async request(method, path, opts = {}) {
    const first = await this.requestOnce(method, path, opts);
    if (first.status === 0 && first.resetBeforeResponse && !this.closed) {
      return this.requestOnce(method, path, opts);
    }
    return first;
  }

  requestOnce(method, path, { name, body, headers, raw = false, record = true } = {}) {
    const t0 = performance.now();
    const payload = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const hdrs = this.headers(headers);
    if (payload) {
      hdrs["content-type"] = "application/json";
      hdrs["content-length"] = payload.length;
    }
    return new Promise((resolve) => {
      const req = http.request(
        { host: this.host, port: this.port, method, path, headers: hdrs, agent: this.agent },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            let buf = Buffer.concat(chunks);
            const wireBytes = buf.length;
            if (res.headers["content-encoding"] === "gzip") {
              try {
                buf = gunzipSync(buf);
              } catch {
                /* keep raw */
              }
            }
            const ms = performance.now() - t0;
            if (record && name) this.metrics.record(name, ms, res.statusCode, wireBytes);
            if (res.statusCode >= 500 && name) this.metrics.error(name, `${res.statusCode} ${method} ${path} ${buf.toString("utf8", 0, 200)}`);
            const text = raw ? null : buf.toString("utf8");
            resolve({
              status: res.statusCode,
              ms,
              headers: res.headers,
              bytes: wireBytes,
              buf,
              text,
              json() {
                try {
                  return JSON.parse(text ?? buf.toString("utf8"));
                } catch {
                  return null;
                }
              },
            });
          });
          res.on("error", (err) => {
            const ms = performance.now() - t0;
            if (record && name) this.metrics.record(name, ms, 0, 0);
            if (name) this.metrics.error(name, `${method} ${path} ${err.message}`);
            resolve({ status: 0, ms, headers: {}, bytes: 0, buf: Buffer.alloc(0), text: "", json: () => null });
          });
        },
      );
      req.setTimeout(this.timeoutMs, () => req.destroy(new Error("timeout")));
      let gotResponse = false;
      req.on("response", () => {
        gotResponse = true;
      });
      req.on("error", (err) => {
        const ms = performance.now() - t0;
        const reset = !gotResponse && reused && /ECONNRESET|socket hang up|EPIPE/.test(err.message);
        if (!reset) {
          if (record && name) this.metrics.record(name, ms, 0, 0);
          if (name && !this.closed) this.metrics.error(name, `${method} ${path} ${err.message}`);
        } else if (name) this.metrics.record("keepalive-retry", 0, 0, 0);
        resolve({ status: 0, ms, headers: {}, bytes: 0, buf: Buffer.alloc(0), text: "", json: () => null, resetBeforeResponse: reset });
      });
      let reused = false;
      req.on("socket", (sock) => {
        reused = !!sock.__apmsUsed;
        sock.__apmsUsed = true;
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path, opts = {}) {
    return this.request("GET", path, opts);
  }
  patch(path, body, opts = {}) {
    return this.request("PATCH", path, { ...opts, body });
  }
  post(path, body, opts = {}) {
    return this.request("POST", path, { ...opts, body });
  }

  /**
   * EventSource-like stream. Uses its own socket (a browser's EventSource
   * holds one of the tab's six connections for as long as it is open).
   * onEvent(data) per `data:` frame. Returns { close() }.
   */
  sse(path, onEvent, { name = "sse-connect", onClose } = {}) {
    const t0 = performance.now();
    let closed = false;
    let firstByte = false;
    const req = http.request({
      host: this.host,
      port: this.port,
      method: "GET",
      path,
      headers: { ...this.headers(), accept: "text/event-stream" },
      agent: this.agent,
    });
    req.on("response", (res) => {
      if (res.statusCode !== 200) {
        this.metrics.record(name, performance.now() - t0, res.statusCode, 0);
        res.resume();
        onClose && onClose(res.statusCode);
        return;
      }
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (chunk) => {
        if (!firstByte) {
          firstByte = true;
          this.metrics.record(name, performance.now() - t0, 200, 0);
        }
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data:")) {
              try {
                onEvent(JSON.parse(line.slice(5).trim()));
              } catch {
                /* ignore bad frame */
              }
            }
          }
        }
      });
      res.on("end", () => {
        if (!closed) onClose && onClose(0);
      });
      res.on("error", () => {});
    });
    req.on("error", (err) => {
      if (!closed && !this.closed) {
        this.metrics.error(name, err.message);
        onClose && onClose(0);
      }
    });
    req.end();
    return {
      close() {
        closed = true;
        req.destroy();
      },
    };
  }

  close() {
    this.closed = true;
    this.agent.destroy();
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function rand(min, max) {
  return min + Math.random() * (max - min);
}
