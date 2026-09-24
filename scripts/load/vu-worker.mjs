/**
 * PERF load runner — one worker process running a slice of simulated users.
 *
 * Each VU does over HTTP what one open APMS tab does (captured from a real
 * Chromium tab on p0as81, see PERF-FINDINGS.md §1):
 *
 *   page open   GET /  (+ static assets on the first open: cold cache)
 *               GET /api/auth/get-session, GET /api/company (gzip),
 *               GET /api/changes?since=<wire feedSeq>&payload=1&limit=500,
 *               EventSource /api/company-live (one socket for the whole visit)
 *   live        GET /api/company-tick           every 2.5 s (SPA timer)
 *               GET /api/company-tick?since=<at> every 2.5 s (sync timer)
 *               any SSE frame / tick whose `at` moved → GET /api/changes?since=<seq>&payload=1&limit=500
 *               (single flight + one re-poll, as apms-sync.js pollChanges)
 *   screen      a screen is picked every 20–60 s; People / Rewards month / APMS month /
 *               APMS person re-read their rows every 2 s while open (the 400 ms
 *               screen-read loop, throttled to 2 s per key); Org / person file read once.
 *   saves       every 20–40 s one row PATCH with baseRev; 20 % on a small set of rows
 *               every VU shares; 409 → take the server row, re-apply my field, retry.
 *               A few VUs create, delete and then stale-edit / stale-recreate a row.
 *   reload      a VU re-opens the page every 4–8 min (browser refresh).
 *
 * Checks recorded per save: read-after-write (row GET right after the 200; a
 * sample also re-reads the company wire + feed replay as a reload would), the
 * time other VUs first see the change in their feed, final state (no lost save,
 * no resurrected delete) is checked by the coordinator against Postgres.
 *
 * Messages: parent → { cmd: "start", config }, { cmd: "stop" }; worker → { type: "done", result }.
 */
import { Client, Metrics, rand, sleep } from "./lib/http.mjs";
import { monitorEventLoopDelay } from "node:perf_hooks";

const metrics = new Metrics();
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let running = true;
const vus = [];

const SCREENS = [
  ["home", 25],
  ["people", 15],
  ["rewards", 15],
  ["apms-month", 10],
  ["apms-person", 15],
  ["org", 10],
  ["person", 10],
];
function pickScreen() {
  const total = SCREENS.reduce((a, s) => a + s[1], 0);
  let r = Math.random() * total;
  for (const [name, w] of SCREENS) {
    if ((r -= w) < 0) return name;
  }
  return "home";
}

function hotPath(row) {
  if (row.table === "month") return `/api/month-records/${row.period}/${encodeURIComponent(row.personId)}`;
  if (row.table === "reward") return `/api/reward-records/${row.period}/${encodeURIComponent(row.personId)}`;
  if (row.table === "people") return `/api/people/${encodeURIComponent(row.id)}`;
  if (row.table === "cell") return `/api/target-cells/${encodeURIComponent(row.id)}`;
  return `/api/e/${row.kind}/${encodeURIComponent(row.id)}`;
}
function feedKey(row) {
  if (row.table === "month") return `month-records|${row.personId}|${row.period}`;
  if (row.table === "reward") return `reward-records|${row.personId}|${row.period}`;
  if (row.table === "people") return `people|${row.id}|`;
  if (row.table === "cell") return `target-cells|${row.id}|`;
  return `${row.kind}|${row.id}|`;
}
function changeKey(ch) {
  if (ch.kind === "month-records" || ch.kind === "reward-records") return `${ch.kind}|${ch.k1}|${ch.k2 || ""}`;
  if (ch.kind === "people" || ch.kind === "target-cells") return `${ch.kind}|${ch.k1 || ch.id}|`;
  return `${ch.kind}|${ch.id}|`;
}

class VU {
  constructor(idx, cfg, login) {
    this.idx = idx;
    this.id = `v${idx}`;
    this.cfg = cfg;
    this.login = login;
    this.c = new Client(cfg.base, metrics, { maxSockets: 6 });
    this.rows = new Map(); // feedKey -> { rev, payload }
    this.seq = 0;
    this.at = 0;
    this.wireAt = 0;
    this.inflight = null;
    this.pollAgain = false;
    this.sse = null;
    this.timers = [];
    this.screen = "home";
    this.saveN = 0;
    this.observer = idx % cfg.observerEvery === 0;
    this.firstOpen = true;
  }

  get phase() {
    return Date.now() >= this.cfg.steadyAt ? "steady" : "ramp";
  }
  name(n) {
    return n;
  }

  async signIn() {
    const r = await this.c.post("/api/auth/sign-in/username", { username: this.login.username, password: this.login.password }, { name: "signin" });
    const body = r.json();
    if (r.status !== 200 || !body?.token) {
      metrics.error("signin", `${r.status} ${this.login.username}`);
      return false;
    }
    this.c.token = body.token;
    this.personId = body.user?.id;
    return true;
  }

  async openPage() {
    const t0 = performance.now();
    const html = await this.c.get("/", { name: "html" });
    if (this.firstOpen && this.cfg.assets?.length) {
      // Cold cache on the first visit: the browser loads every stamped asset (6 at a time).
      const list = this.cfg.assets.slice();
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          for (let a = list.shift(); a; a = list.shift()) await this.c.get(a, { name: "static", raw: true });
        }),
      );
    }
    this.firstOpen = false;
    await this.c.get("/api/auth/get-session", { name: "get-session" });
    const tc = performance.now();
    const w = await this.c.get("/api/company", { name: "company" });
    metrics.record("company-load", performance.now() - tc, w.status, w.bytes);
    const outer = w.json();
    let feedSeq = 0;
    if (outer && outer.snapshotJson) {
      // Only the envelope fields we need; the SPA parses the whole snapshot.
      const snap = JSON.parse(outer.snapshotJson);
      feedSeq = Number(snap.feedSeq) || 0;
      this.wireAt = Number(outer.notebookUpdatedAt) || 0;
      this.at = Math.max(this.at, this.wireAt);
    }
    this.seq = feedSeq;
    await this.pollChanges();
    metrics.record("page-open-http", performance.now() - t0, html.status, 0);
    this.openLive();
  }

  openLive() {
    if (this.sse) this.sse.close();
    this.sse = this.c.sse(
      "/api/company-live",
      (ev) => this.onLive(ev, "sse"),
      {
        onClose: () => {
          if (running && this.alive) setTimeout(() => this.alive && this.openLive(), 3000);
        },
      },
    );
  }

  onLive(ev, via) {
    const at = Number(ev && ev.at) || 0;
    if (at > this.at) {
      this.at = at;
      void this.pollChanges();
    }
  }

  async tick(withSince) {
    const path = withSince ? `/api/company-tick?since=${this.at || this.wireAt || 0}` : "/api/company-tick";
    const r = await this.c.get(path, { name: withSince ? "tick-since" : "tick" });
    if (r.status === 200) this.onLive(r.json(), "tick");
  }

  pollChanges() {
    if (this.inflight) {
      this.pollAgain = true;
      return this.inflight;
    }
    this.pollAgain = false;
    const since = this.seq;
    this.inflight = (async () => {
      const r = await this.c.get(`/api/changes?since=${since}&payload=1&limit=500`, { name: "changes" });
      const body = r.status === 200 ? r.json() : null;
      const now = Date.now();
      if (body && Array.isArray(body.changes)) {
        this.seq = Math.max(this.seq, Number(body.seq) || 0);
        for (const ch of body.changes) {
          const key = changeKey(ch);
          const known = this.rows.get(key);
          if (known && Number(ch.rev) >= known.rev) this.rows.set(key, { rev: Number(ch.rev), payload: ch.payload || {}, deleted: !!ch.deleted });
          const mark = ch.payload && ch.payload.lastMark;
          if (this.observer && mark && !String(mark).startsWith(this.id + ":")) {
            metrics.events.push({ e: "seen", mark, t: now, by: this.id });
          }
        }
      }
    })().finally(() => {
      this.inflight = null;
      if (this.pollAgain && this.alive) void this.pollChanges();
    });
    return this.inflight;
  }

  async screenLoop() {
    while (this.alive) {
      this.screen = pickScreen();
      const until = Date.now() + rand(20000, 60000);
      let first = true;
      while (this.alive && Date.now() < until) {
        await this.readScreen(first);
        first = false;
        await sleep(2000);
      }
    }
  }

  async readScreen(first) {
    const f = this.cfg.fixture;
    const period = f.period;
    const s = this.screen;
    // The runner does not need the rows; `raw` skips decoding the body (runner CPU).
    if (s === "people") return this.c.get("/api/people?limit=80", { name: "people-list", raw: true });
    if (s === "rewards") return this.c.get(`/api/reward-records/${f.rewardPeriod}?limit=80`, { name: "rewards-month", raw: true });
    if (s === "apms-month") return this.c.get(`/api/month-records/${period}?limit=80`, { name: "apms-month", raw: true });
    if (s === "apms-person") {
      const pid = f.people[this.idx % f.people.length];
      return this.c.get(`/api/month-records/${period}/${encodeURIComponent(pid)}`, { name: "apms-person" });
    }
    if (!first) return null;
    if (s === "org") {
      const kind = ["roles", "functions", "sbus", "brands"][Math.floor(Math.random() * 4)];
      return this.c.get(`/api/org?kind=${kind}`, { name: "org-kind" });
    }
    if (s === "person") {
      const pid = f.people[Math.floor(Math.random() * f.people.length)];
      return this.c.get(`/api/people/${encodeURIComponent(pid)}`, { name: "person" });
    }
    return null;
  }

  pickSaveRow() {
    const f = this.cfg.fixture;
    if (Math.random() < 0.2) return { ...f.shared[Math.floor(Math.random() * f.shared.length)], shared: true };
    const i = this.idx;
    const r = Math.random();
    const pid = f.people[i % f.people.length];
    if (r < 0.35) return { table: "month", period: f.period, personId: pid };
    if (r < 0.6) return { table: "reward", period: f.rewardPeriod, personId: pid };
    if (r < 0.75) return { table: "people", id: pid };
    return { table: "entity", kind: "target-history", id: f.history[i % f.history.length] };
  }

  async currentRow(row) {
    const key = feedKey(row);
    const known = this.rows.get(key);
    if (known) return known;
    const r = await this.c.get(hotPath(row), { name: "row-read" });
    const b = r.json();
    if (r.status !== 200 || !b) return null;
    const cur = { rev: Number(b.rev) || 0, payload: b.payload || {}, deleted: !!b.deleted };
    this.rows.set(key, cur);
    return cur;
  }

  async save(row, edit, name) {
    const key = feedKey(row);
    let cur = await this.currentRow(row);
    if (!cur || cur.deleted) return { status: "skip" };
    for (let attempt = 0; attempt < 6; attempt++) {
      const payload = edit(cur.payload);
      const t0 = Date.now();
      const r = await this.c.patch(hotPath(row), { baseRev: cur.rev, payload, clientOpId: `${this.id}-${Date.now()}-${attempt}` }, { name });
      const b = r.json() || {};
      if (r.status === 200) {
        const rev = Number(b.rev) || cur.rev + 1;
        this.rows.set(key, { rev, payload, deleted: false });
        return { status: 200, rev, payload, sentAt: t0, ackAt: Date.now(), attempts: attempt + 1 };
      }
      if (r.status === 409) {
        metrics.record("save-409", 0, 409, 0);
        if (b.deleted) {
          this.rows.set(key, { rev: Number(b.rev) || 0, payload: b.payload || {}, deleted: true });
          return { status: "deleted" };
        }
        cur = { rev: Number(b.rev) || 0, payload: b.payload || {}, deleted: false };
        this.rows.set(key, cur);
        continue;
      }
      return { status: r.status };
    }
    return { status: "gave-up" };
  }

  async doSave() {
    const row = this.pickSaveRow();
    const n = ++this.saveN;
    const mark = `${this.id}:${n}`;
    const edit = (p) => ({ ...p, lastMark: mark, loadMarks: { ...(p && p.loadMarks), [this.id]: n } });
    const res = await this.save(row, edit, `save-${row.table === "entity" ? row.kind : row.table}${row.shared ? "-shared" : ""}`);
    if (res.status === 200) {
      metrics.events.push({ e: "ack", mark, vu: this.id, n, row: feedKey(row), path: hotPath(row), t: res.ackAt, sent: res.sentAt, attempts: res.attempts });
      // Read-after-write: the row right away, as the screen's next read does.
      const r = await this.c.get(hotPath(row), { name: "raw-row" });
      const b = r.json();
      const ok = !!b && b.payload && b.payload.loadMarks && Number(b.payload.loadMarks[this.id]) >= n;
      // A read that failed (timeout under overload) is not a stale read: recorded apart.
      if (r.status === 200) metrics.events.push({ e: "raw", kind: "row", ok, mark, why: ok ? undefined : `rev ${b && b.rev} vs acked ${res.rev}` });
      else metrics.events.push({ e: "raw", kind: "row-failed", ok: false, mark, why: `status ${r.status}` });
      if (Math.random() < this.cfg.rawWireSample) await this.rawWire(row, mark, n);
    } else if (res.status !== "skip" && res.status !== "deleted") {
      metrics.error("save", `${res.status} ${hotPath(row)}`);
    }
  }

  /** A reload right after the save: company wire, then the feed replay from its feedSeq. */
  async rawWire(row, mark, n) {
    const w = await this.c.get("/api/company", { name: "raw-company" });
    const outer = w.json();
    if (!outer || !outer.snapshotJson) {
      metrics.events.push({ e: "raw", kind: "wire", ok: false, mark, why: outer?.unchanged ? "unchanged" : `status ${w.status}` });
      return;
    }
    const snap = JSON.parse(outer.snapshotJson);
    let inWire = false;
    let p = null;
    if (row.table === "month") p = snap.records?.[row.period]?.[row.personId];
    else if (row.table === "reward") p = snap.rewardRecords?.[row.period]?.[row.personId];
    else if (row.table === "people") p = (snap.people || []).find((x) => x && x.id === row.id);
    else if (row.table === "cell") p = snap.targetCells?.[row.id];
    else if (row.kind === "target-history") p = (snap.targetHistory || []).find((x) => x && x.id === row.id);
    else if (row.kind === "kpi-master") p = (snap.kpiMaster || []).find((x) => x && x.id === row.id);
    inWire = !!p && p.loadMarks && Number(p.loadMarks[this.id]) >= n;
    let inReplay = inWire;
    if (!inWire) {
      const f = await this.c.get(`/api/changes?since=${Number(snap.feedSeq) || 0}&payload=1&limit=500`, { name: "raw-replay" });
      const fb = f.json();
      const key = feedKey(row);
      inReplay = !!fb?.changes?.some((ch) => changeKey(ch) === key && ch.payload?.loadMarks && Number(ch.payload.loadMarks[this.id]) >= n);
    }
    metrics.events.push({ e: "raw", kind: "wire", ok: inWire, mark });
    metrics.events.push({ e: "raw", kind: "wire+replay", ok: inReplay, mark });
  }

  /** Delete safety: create a row, delete it, then a stale edit and a stale re-create must both be refused. */
  async deleteProbe() {
    const id = `nt-lr-${this.id}-${++this.saveN}`;
    const path = `/api/e/notices/${id}`;
    const c1 = await this.c.patch(path, { baseRev: 0, payload: { id, title: "load probe", body: "x" }, clientOpId: `${id}-c` }, { name: "save-notices" });
    if (c1.status !== 200) return metrics.error("delete-probe", `create ${c1.status}`);
    const rev = Number(c1.json()?.rev) || 1;
    const d = await this.c.patch(path, { baseRev: rev, deleted: true, payload: {}, clientOpId: `${id}-d` }, { name: "save-notices" });
    if (d.status !== 200) return metrics.error("delete-probe", `delete ${d.status}`);
    const stale = await this.c.patch(path, { baseRev: rev, payload: { id, title: "stale edit" }, clientOpId: `${id}-s` }, { name: "save-notices" });
    const again = await this.c.patch(path, { baseRev: 0, payload: { id, title: "stale re-create" }, clientOpId: `${id}-r` }, { name: "save-notices" });
    metrics.events.push({ e: "deleted", id, staleStatus: stale.status, recreateStatus: again.status });
  }

  async run() {
    this.alive = true;
    if (!(await this.signIn())) return;
    await this.openPage();
    this.timers.push(setInterval(() => void this.tick(false), 2500));
    await sleep(rand(0, 2500));
    this.timers.push(setInterval(() => void this.tick(true), 2500));
    void this.screenLoop();
    void (async () => {
      await sleep(rand(5000, 30000));
      while (this.alive) {
        if (Math.random() < this.cfg.deleteProbeRate) await this.deleteProbe();
        else await this.doSave();
        await sleep(rand(20000, 40000));
      }
    })();
    void (async () => {
      while (this.alive) {
        await sleep(rand(240000, 480000));
        if (!this.alive) break;
        await this.openPage();
      }
    })();
  }

  stop() {
    this.alive = false;
    for (const t of this.timers) clearInterval(t);
    if (this.sse) this.sse.close();
    this.c.close();
  }
}

process.on("message", async (msg) => {
  if (msg.cmd === "start") {
    const cfg = msg.config;
    const { logins, rampMs } = cfg;
    const t0 = Date.now();
    for (let i = 0; i < logins.length; i++) {
      if (!running) break;
      const at = t0 + (rampMs * i) / Math.max(1, logins.length);
      const wait = at - Date.now();
      if (wait > 0) await sleep(wait);
      const vu = new VU(cfg.firstIdx + i, cfg, logins[i]);
      vus.push(vu);
      void vu.run().catch((err) => metrics.error("vu", err.stack || err.message));
    }
  } else if (msg.cmd === "stop") {
    running = false;
    for (const vu of vus) vu.stop();
    await sleep(200);
    process.send({
      type: "done",
      result: { ...metrics.toJSON(), loopLag: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 }, cpu: process.cpuUsage() },
    });
    setTimeout(() => process.exit(0), 200);
  }
});
