#!/usr/bin/env node
/**
 * PERF load runner — coordinator. One run = one user level on a fresh database.
 *
 *   node scripts/load/run.mjs --users=50 [--steady=180] [--ramp=auto] [--workers=4]
 *        [--browsers=3] [--profile] [--label=before] [--out=docs/perf/runs]
 *        [--server-cpus=0] [--pg-cpus=1] [--runner-cpus=2,3] [--reuse-server]
 *
 * Steps: fresh DB with the production-sized fixture (scale-fixture.mjs) and the
 * built server (.output) started with the event-loop monitor preloaded (and
 * --cpu-prof with --profile); every active person gets a test password; N
 * simulated users (vu-worker.mjs, split over worker processes) ramp in, then a
 * steady window is measured while a few real headless Chromium tabs time page
 * opens. Then the final database state is checked (every acknowledged save is
 * there, every deleted row is still deleted) and a JSON + Markdown summary is
 * written. Nothing here changes the product.
 */
import { fork, spawnSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { marksOf } from "./lib/marks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  }),
);
const USERS = Number(args.users || 10);
const STEADY_S = Number(args.steady || 180);
const RAMP_S = args.ramp && args.ramp !== "auto" ? Number(args.ramp) : Math.max(10, Math.ceil(USERS / 4));
const WORKERS = Number(args.workers || Math.min(4, Math.max(1, Math.ceil(USERS / 60))));
const BROWSERS = Number(args.browsers ?? 3);
const PORT = Number(args.port || 3020);
const BASE = `http://127.0.0.1:${PORT}`;
const PGURL = args.pgurl || "postgres://postgres:pg@127.0.0.1:5432";
const DB = args.db || "aliens_apms_load";
const DATABASE_URL = `${PGURL}/${DB}`;
const LABEL = args.label || "run";
const OUT = resolve(root, args.out || "docs/perf/runs");
const RUN_ID = `${LABEL}-u${USERS}`;
const RUN_DIR = join(OUT, RUN_ID);
const TMP = process.env.LOAD_TMP || "/tmp/apms-load";
const SERVER_CPUS = args["server-cpus"] ?? "0";
const PG_CPUS = args["pg-cpus"] ?? "1";
const RUNNER_CPUS = args["runner-cpus"] ?? "2,3";
// The timed browsers can get a core of their own (page opens are browser CPU as much as server time).
const BROWSER_CPUS = args["browser-cpus"] ?? RUNNER_CPUS;
const PASSWORD = "Load-test-1";
const OUTPUT_DIR = args.output || ".output";
const SERVER_ENV = args["server-env"] ? String(args["server-env"]).split(",") : [];

mkdirSync(RUN_DIR, { recursive: true });
mkdirSync(TMP, { recursive: true });
const log = (...m) => console.log(`[load ${RUN_ID}]`, ...m);

function pin(pid, cpus) {
  if (!cpus || cpus === "none") return;
  spawnSync("taskset", ["-a", "-p", "-c", String(cpus), String(pid)], { stdio: "ignore" });
}

function pgPids() {
  const out = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const comm = readFileSync(`/proc/${d}/comm`, "utf8").trim();
      if (comm.startsWith("postgres")) out.push(Number(d));
    } catch {
      /* gone */
    }
  }
  return out;
}

function procTicks(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
    return Number(f[11]) + Number(f[12]); // utime + stime (after pid/comm: state is f[0])
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- server
async function startServer() {
  const elmon = join(TMP, `elmon-${RUN_ID}.jsonl`);
  rmSync(elmon, { force: true });
  const profDir = join(RUN_DIR, "cpuprof");
  const nodeOpts = [`--import=${join(root, "scripts/load/elmon.mjs")}`];
  if (args.profile) {
    rmSync(profDir, { recursive: true, force: true });
    mkdirSync(profDir, { recursive: true });
    nodeOpts.push("--cpu-prof", `--cpu-prof-dir=${profDir}`);
  }
  const env = {
    ...process.env,
    PORT: String(PORT),
    DB,
    PGURL,
    FIXTURE: process.env.FIXTURE || "/tmp/apms-load-fixture.json",
    LOG: join(TMP, `server-${RUN_ID}.log`),
    OUTPUT: OUTPUT_DIR,
    NODE_OPTS: nodeOpts.join(" "),
    ELMON_FILE: elmon,
    CPUS: SERVER_CPUS === "none" ? "" : String(SERVER_CPUS),
  };
  for (const kv of SERVER_ENV) {
    const [k, v] = kv.split("=");
    env[k] = v;
  }
  if (args["reuse-db"]) env.REUSE_DB = "1";
  const r = spawnSync("sh", [join(root, "scripts/load/fresh-load-server.sh")], { cwd: root, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`server start failed: ${r.stderr}${r.stdout}`);
  const pid = Number(readFileSync("/tmp/apms-load-server.pid", "utf8").trim());
  // Warm: the first company read builds the wire and fills the hot tables from the books.
  const si = await fetch(`${BASE}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "sunny.b", password: "0000" }),
  }).then((r) => r.json());
  await fetch(`${BASE}/api/company`, { headers: { authorization: `Bearer ${si.token}` } }).then((r) => r.arrayBuffer());
  return { pid, elmon, profDir };
}

async function stopServer(pid) {
  try {
    process.kill(pid, "SIGINT");
  } catch {
    return;
  }
  // A busy server with --cpu-prof takes a while to write its profile on exit.
  for (let i = 0; i < 900; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* gone */
  }
}

// ---------------------------------------------------------------- fixture
async function prepareFixture(pool) {
  // Every active person can sign in with the test password (issued_logins, as seed-logins.mjs).
  await pool.query(`create table if not exists issued_logins (
    username text primary key, person_id text, password text not null,
    updated_at timestamptz not null default now())`);
  const people = (
    await pool.query(
      `select id, payload->>'username' as username, payload->>'status' as status, payload->>'access' as access,
              coalesce(payload->>'mustResetPassword','false') as must_reset from people
        where deleted_at is null and coalesce(payload->>'username','') <> '' order by id`,
    )
  ).rows.filter((p) => !["left", "exited", "paused"].includes(String(p.status || "").toLowerCase()));
  for (const p of people) {
    await pool.query(
      `insert into issued_logins (username, person_id, password) values ($1, $2, $3)
       on conflict (username) do update set person_id = excluded.person_id, password = excluded.password, updated_at = now()`,
      [p.username, p.id, PASSWORD],
    );
  }
  // The server imports the hot tables in the background after boot (p0as81
  // lazily); a run that started before it had no month to save to.
  for (let i = 0; i < 240; i++) {
    const n = (await pool.query(`select (select count(*) from month_records) m, (select count(*) from reward_records) r`)).rows[0];
    if (Number(n.m) > 0 && Number(n.r) > 0) break;
    if (i === 239) throw new Error("hot tables never imported (month_records / reward_records empty)");
    await new Promise((r) => setTimeout(r, 500));
  }
  const period = (await pool.query(`select period from month_records where deleted_at is null group by 1 order by count(*) desc limit 1`)).rows[0]?.period;
  const rewardPeriod = (await pool.query(`select period from reward_records where deleted_at is null group by 1 order by count(*) desc limit 1`)).rows[0]?.period;
  const monthPeople = (await pool.query(`select person_id from month_records where period = $1 and deleted_at is null order by person_id`, [period])).rows.map((r) => r.person_id);
  const rewardPeople = new Set((await pool.query(`select person_id from reward_records where period = $1 and deleted_at is null`, [rewardPeriod])).rows.map((r) => r.person_id));
  const ids = monthPeople.filter((id) => rewardPeople.has(id));
  const history = (await pool.query(`select id from entities where kind = 'target-history' and deleted_at is null order by id`)).rows.map((r) => r.id);
  const cell = (await pool.query(`select id from target_cells where deleted_at is null order by id limit 1`)).rows[0]?.id;
  const kpi = (await pool.query(`select id from entities where kind = 'kpi-master' and deleted_at is null order by id limit 1`)).rows[0]?.id;
  const shared = [
    { table: "month", period, personId: ids[0] },
    { table: "month", period, personId: ids[1] },
    { table: "reward", period: rewardPeriod, personId: ids[2] },
    { table: "cell", id: cell },
    { table: "entity", kind: "kpi-master", id: kpi },
    { table: "people", id: ids[3] },
  ].filter((r) => r.personId || r.id);
  // Own rows are distinct from the shared ones.
  const own = ids.slice(4);
  return {
    // Browsers take people without a forced password change (last in the list).
    logins: [...people.filter((p) => p.must_reset === "true"), ...people.filter((p) => p.must_reset !== "true")].map((p) => ({
      username: p.username,
      password: PASSWORD,
      personId: p.id,
      editor: ["admin", "super_admin"].includes(String(p.access || "")),
      browserOk: p.must_reset !== "true",
    })),
    fixture: { period, rewardPeriod, people: own, history: history.slice(0, 600), shared, monthPeople, rewardPeople: [...rewardPeople] },
  };
}

/** Which browser sync the server ships (the runner models that client's requests). */
async function clientVersion() {
  const html = await (await fetch(`${BASE}/`)).text();
  const m = html.match(/apms-sync\.js\?v=(p0as\d+)/);
  const v = m ? m[1] : "p0as81";
  return Number(v.slice(4)) >= 83 ? "p0as83" : "p0as81";
}

async function assetList() {
  const html = await (await fetch(`${BASE}/`)).text();
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) out.add(m[1]);
  return [...out];
}

// ---------------------------------------------------------------- browsers
async function browserProbe(stopAt, results) {
  if (!BROWSERS) return;
  const { chromium } = await import("playwright");
  const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
  // Every Chromium process (renderers included) on the browsers' cores.
  const wrapper = join(TMP, "chromium-pinned.sh");
  writeFileSync(wrapper, `#!/bin/sh\nexec taskset -c ${BROWSER_CPUS} ${exe} "$@"\n`, { mode: 0o755 });
  const browser = await chromium.launch({ executablePath: BROWSER_CPUS === "none" ? exe : wrapper });
  try {
    const bpid = browser.process?.()?.pid;
    if (bpid) pin(bpid, BROWSER_CPUS);
  } catch {
    /* ignore */
  }
  // Page opens are timed for both kinds of user: employees get their own
  // (filtered) company, editors the whole one (slower to hydrate in the browser).
  const clean = results.logins.filter((l) => l.browserOk);
  const eds = clean.filter((l) => l.editor);
  const emps = clean.filter((l) => !l.editor);
  const users = Array.from({ length: BROWSERS }, (_, i) => (i % 3 === 2 ? eds[i] || emps[i] : emps[i] || eds[i])).filter(Boolean);
  await Promise.all(
    users.map(async (u, i) => {
      await new Promise((r) => setTimeout(r, i * 4000));
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => {
        // A closed EventSource surfaces as a bare "Event" error; not an app error.
        if (String(e) !== "Event") results.browserErrors.push(String(e).slice(0, 200));
      });
      try {
        const t0 = Date.now();
        await p.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
        await p.locator('input[type="text"]').fill(u.username);
        await p.locator('input[type="password"]').fill(u.password);
        const t1 = Date.now();
        const company = p.waitForResponse((r) => r.url().includes("/api/company") && r.request().method() === "GET", { timeout: 90000 });
        await p.getByRole("button", { name: "Continue" }).click();
        await p.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 90000 });
        await company.catch(() => null);
        results.pageOpen.push({ kind: "sign-in", ms: Date.now() - t1, total: Date.now() - t0, editor: !!u.editor });
      } catch (err) {
        results.browserErrors.push(`sign-in ${u.username}: ${err.message.slice(0, 160)}`);
        await ctx.close();
        return;
      }
      while (Date.now() < stopAt - 15000) {
        await new Promise((r) => setTimeout(r, 12000 + Math.random() * 8000));
        try {
          const t0 = Date.now();
          let companyMs = null;
          const company = p
            .waitForResponse((r) => r.url().includes("/api/company") && !r.url().includes("tick") && !r.url().includes("live") && r.request().method() === "GET", { timeout: 90000 })
            .then(async (r) => {
              await r.finished().catch(() => null);
              const t = r.request().timing();
              companyMs = t.responseEnd > 0 ? t.responseEnd - t.requestStart : Date.now() - t0;
            });
          // One page open may not hang the probe: 60 s cap, recorded as a failure.
          const opened = await Promise.race([
            (async () => {
              await p.reload({ waitUntil: "load", timeout: 60000 });
              await p.locator("aside, nav").first().getByText("Me", { exact: true }).first().waitFor({ timeout: 60000 });
              await company.catch(() => null);
              return true;
            })(),
            new Promise((r) => setTimeout(() => r(false), 60000)),
          ]);
          if (opened) results.pageOpen.push({ kind: "reload", ms: Date.now() - t0, companyMs, editor: !!u.editor });
          else results.browserErrors.push(`reload ${u.username}: page open > 60 s`);
        } catch (err) {
          results.browserErrors.push(`reload ${u.username}: ${err.message.slice(0, 160)}`);
        }
      }
      await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 5000))]);
    }),
  );
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
}

// ---------------------------------------------------------------- stats
function pct(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function summarize(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, avg: Math.round(sum / s.length), p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] };
}

// ---------------------------------------------------------------- main
async function main() {
  const t00 = Date.now();
  log(`users=${USERS} steady=${STEADY_S}s ramp=${RAMP_S}s workers=${WORKERS} browsers=${BROWSERS} profile=${!!args.profile}`);
  const server = await startServer();
  pin(server.pid, SERVER_CPUS);
  for (const pid of pgPids()) pin(pid, PG_CPUS);
  pin(process.pid, RUNNER_CPUS);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const prep = await prepareFixture(pool);
  const assets = await assetList();
  const client = args.client || (await clientVersion());
  // Editors spread evenly over any number of users (≈ their share of the logins).
  const editorsAll = prep.logins.filter((l) => l.editor);
  const othersAll = prep.logins.filter((l) => !l.editor);
  const share = editorsAll.length / prep.logins.length;
  log(`client ${client}; fixture: ${prep.logins.length} logins (${editorsAll.length} editors), period ${prep.fixture.period}, reward ${prep.fixture.rewardPeriod}, ${assets.length} assets`);

  // Enough logins for N users: a person with two tabs is realistic past 180.
  // Browsers take their own logins (no forced password change); users cycle the rest.
  const cleanL = prep.logins.filter((l) => l.browserOk);
  const bEds = cleanL.filter((l) => l.editor);
  const bEmps = cleanL.filter((l) => !l.editor);
  const browserLogins = new Set(
    Array.from({ length: BROWSERS }, (_, i) => (i % 3 === 2 ? bEds[i] || bEmps[i] : bEmps[i] || bEds[i])).filter(Boolean).map((l) => l.username),
  );
  const eds = editorsAll.filter((l) => !browserLogins.has(l.username));
  const oth = othersAll.filter((l) => !browserLogins.has(l.username));
  let ei = 0;
  let oi = 0;
  const logins = Array.from({ length: USERS }, (_, i) =>
    Math.floor((i + 1) * share) > Math.floor(i * share) ? eds[ei++ % eds.length] : oth[oi++ % oth.length],
  );
  const now = Date.now();
  const steadyAt = now + RAMP_S * 1000 + 10000;
  const stopAt = steadyAt + STEADY_S * 1000;
  const config = {
    base: BASE,
    client,
    fixture: prep.fixture,
    assets,
    rampMs: RAMP_S * 1000,
    steadyAt,
    observerEvery: USERS >= 100 ? 3 : 1,
    editorSharedRate: 0.7,
    rawWireSample: USERS >= 100 ? 0.03 : 0.1,
    deleteProbeRate: 0.05,
  };
  const workers = [];
  const per = Math.ceil(USERS / WORKERS);
  for (let w = 0; w < WORKERS; w++) {
    const slice = logins.slice(w * per, (w + 1) * per);
    if (!slice.length) continue;
    const child = fork(join(root, "scripts/load/vu-worker.mjs"), [], { stdio: "inherit" });
    pin(child.pid, RUNNER_CPUS);
    // The timed browsers share these cores: they go first (page opens are the
    // browser's CPU as much as the server's), the simulated users yield.
    spawnSync("renice", ["-n", "10", "-p", String(child.pid)], { stdio: "ignore" });
    const done = new Promise((res) => child.on("message", (m) => m.type === "done" && res(m.result)));
    child.send({ cmd: "start", config: { ...config, logins: slice, firstIdx: w * per } });
    workers.push({ child, done });
  }

  // Samplers: server (elmon), Postgres CPU, runner CPU.
  const hz = 100;
  const pgSamples = [];
  let lastPg = pgPids().reduce((a, p) => a + procTicks(p), 0);
  let lastT = Date.now();
  const pgTimer = setInterval(() => {
    const ticks = pgPids().reduce((a, p) => a + procTicks(p), 0);
    const t = Date.now();
    pgSamples.push({ t, cpu: (100 * (ticks - lastPg)) / hz / ((t - lastT) / 1000) });
    lastPg = ticks;
    lastT = t;
    for (const pid of pgPids()) pin(pid, PG_CPUS);
  }, 1000);

  // Query statistics for the steady window (needs pg_stat_statements; skipped when absent).
  let pgss = false;
  setTimeout(async () => {
    try {
      await pool.query("create extension if not exists pg_stat_statements");
      await pool.query("select pg_stat_statements_reset()");
      pgss = true;
    } catch {
      pgss = false;
    }
  }, Math.max(0, steadyAt - Date.now()));

  const browserResults = { logins: prep.logins, pageOpen: [], browserErrors: [] };
  const browserRun = (async () => {
    await new Promise((r) => setTimeout(r, Math.max(0, steadyAt - Date.now())));
    await browserProbe(stopAt, browserResults).catch((err) => browserResults.browserErrors.push(`probe: ${err.message}`));
  })();

  const pgConnSamples = [];
  const connTimer = setInterval(async () => {
    try {
      const r = await pool.query(`select count(*)::int n, count(*) filter (where state = 'active')::int active from pg_stat_activity where datname = $1`, [DB]);
      pgConnSamples.push(r.rows[0]);
    } catch {
      /* ignore */
    }
  }, 5000);

  while (Date.now() < stopAt) {
    await new Promise((r) => setTimeout(r, 10000));
    const lines = existsSync(server.elmon) ? readFileSync(server.elmon, "utf8").trim().split("\n").slice(-10).map((l) => JSON.parse(l)) : [];
    const cpu = lines.length ? Math.round(lines.reduce((a, l) => a + l.cpu, 0) / lines.length) : "?";
    const lag = lines.length ? Math.max(...lines.map((l) => l.lagMax)) : "?";
    log(`${Date.now() < steadyAt ? "ramp" : "steady"} t=${Math.round((Date.now() - now) / 1000)}s server cpu≈${cpu}% lagMax=${lag}ms`);
  }
  for (const w of workers) w.child.send({ cmd: "stop" });
  const parts = await Promise.all(workers.map((w) => w.done));
  await browserRun;
  clearInterval(pgTimer);
  clearInterval(connTimer);

  let topQueries = [];
  if (pgss) {
    try {
      topQueries = (
        await pool.query(
          `select calls::int, round(total_exec_time)::int as total_ms, round(mean_exec_time::numeric, 2)::float as mean_ms, rows::int,
                  left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as query
             from pg_stat_statements s join pg_database d on d.oid = s.dbid
            where d.datname = $1 order by total_exec_time desc limit 15`,
          [DB],
        )
      ).rows;
    } catch {
      topQueries = [];
    }
  }

  // Settle: in-flight background work (book mirrors) finishes before the final check.
  await new Promise((r) => setTimeout(r, 3000));

  // ---- merge
  const routes = {};
  const events = [];
  const errors = [];
  let runnerLagMax = 0;
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.routes)) {
      const r = (routes[k] = routes[k] || { ms: [], bytes: [], status: {} });
      r.ms.push(...v.ms);
      r.bytes.push(...v.bytes);
      for (const [s, n] of Object.entries(v.status)) r.status[s] = (r.status[s] || 0) + n;
    }
    events.push(...p.events);
    errors.push(...p.errors);
    runnerLagMax = Math.max(runnerLagMax, p.loopLag.max);
  }

  // ---- final state: acknowledged saves present, deletes stand
  const lastAck = new Map(); // row|vu -> {n, path}
  for (const e of events) {
    if (e.e !== "ack") continue;
    const k = `${e.row}|${e.vu}`;
    const prev = lastAck.get(k);
    if (!prev || e.n > prev.n) lastAck.set(k, e);
  }
  let lost = 0;
  const lostList = [];
  const rowsCache = new Map();
  async function readRowForCheck(rowKey) {
    if (rowsCache.has(rowKey)) return rowsCache.get(rowKey);
    const [kind, a, b] = rowKey.split("|");
    let q;
    if (kind === "month-records") q = pool.query(`select payload, deleted_at from month_records where person_id=$1 and period=$2`, [a, b]);
    else if (kind === "reward-records") q = pool.query(`select payload, deleted_at from reward_records where person_id=$1 and period=$2`, [a, b]);
    else if (kind === "people") q = pool.query(`select payload, deleted_at from people where id=$1`, [a]);
    else if (kind === "target-cells") q = pool.query(`select payload, deleted_at from target_cells where id=$1`, [a]);
    else q = pool.query(`select payload, deleted_at from entities where kind=$1 and id=$2`, [kind, a]);
    const row = (await q).rows[0] || null;
    rowsCache.set(rowKey, row);
    return row;
  }
  for (const [, e] of lastAck) {
    const row = await readRowForCheck(e.row);
    const got = row && row.payload ? Number(marksOf(e.row.split("|")[0], row.payload)[e.vu]) : NaN;
    if (!(got >= e.n)) {
      lost++;
      if (lostList.length < 20) lostList.push({ row: e.row, vu: e.vu, acked: e.n, db: got });
    }
  }
  // The books (what a backup / fallback assemble reads) must also carry the last write.
  let resurrected = 0;
  const deletes = events.filter((e) => e.e === "deleted");
  const badDeleteReplies = deletes.filter((d) => d.staleStatus !== 409 || d.recreateStatus !== 409);
  for (const d of deletes) {
    const r = (await pool.query(`select deleted_at from entities where kind='notices' and id=$1`, [d.id])).rows[0];
    if (!r || !r.deleted_at) resurrected++;
  }

  // ---- visibility (others see a save)
  const acks = new Map(events.filter((e) => e.e === "ack").map((e) => [e.mark, e]));
  const vis = [];
  for (const e of events) {
    if (e.e !== "seen") continue;
    const a = acks.get(e.mark);
    if (!a) continue;
    // Only saves made while that tab was live (not ones it caught up on when it opened).
    if (!(a.sent >= (e.ls ?? 0))) continue;
    vis.push(Math.max(0, e.t - a.t));
  }
  const raw = {};
  for (const e of events.filter((x) => x.e === "raw")) {
    const r = (raw[e.kind] = raw[e.kind] || { n: 0, bad: 0, why: {} });
    r.n++;
    if (!e.ok) {
      r.bad++;
      if (e.why) r.why[e.why] = (r.why[e.why] || 0) + 1;
    }
  }

  // ---- server samples (steady window only)
  const el = existsSync(server.elmon) ? readFileSync(server.elmon, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const steadyEl = el.filter((l) => l.t >= steadyAt && l.t <= stopAt);
  const steadyPg = pgSamples.filter((l) => l.t >= steadyAt && l.t <= stopAt);

  await stopServer(server.pid);
  await pool.end();

  const routeSummary = {};
  for (const [k, v] of Object.entries(routes)) {
    routeSummary[k] = { ...summarize(v.ms), bytesAvg: Math.round(v.bytes.reduce((a, b) => a + b, 0) / Math.max(1, v.bytes.length)), status: v.status };
  }
  const saveMs = Object.entries(routes).filter(([k]) => k.startsWith("save-") && k !== "save-409").flatMap(([, v]) => v.ms);
  const reloads = browserResults.pageOpen.filter((p) => p.kind === "reload");
  const summary = {
    id: RUN_ID,
    label: LABEL,
    users: USERS,
    client,
    steadySeconds: STEADY_S,
    cores: { server: SERVER_CPUS, postgres: PG_CPUS, runner: RUNNER_CPUS, browsers: BROWSER_CPUS },
    at: new Date().toISOString(),
    targets: {
      pageOpenMs: summarize(reloads.map((p) => p.ms)),
      pageOpenEmployeeMs: summarize(reloads.filter((p) => !p.editor).map((p) => p.ms)),
      pageOpenEditorMs: summarize(reloads.filter((p) => p.editor).map((p) => p.ms)),
      signInOpenMs: summarize(browserResults.pageOpen.filter((p) => p.kind === "sign-in").map((p) => p.ms)),
      companyLoadMs: summarize(routes["company-load"]?.ms || []),
      browserCompanyMs: summarize(reloads.map((p) => p.companyMs).filter((x) => x != null).map(Math.round)),
      tickMs: summarize([...(routes.tick?.ms || []), ...(routes["tick-since"]?.ms || [])]),
      saveMs: summarize(saveMs),
      othersSeeMs: { ...summarize(vis), under1s: vis.length ? +(vis.filter((x) => x < 1000).length / vis.length).toFixed(4) : null },
      serverCpu: summarize(steadyEl.map((l) => l.cpu)),
      serverLagMs: { p99Max: Math.max(0, ...steadyEl.map((l) => l.lagP99)), max: Math.max(0, ...steadyEl.map((l) => l.lagMax)), p50Avg: +(steadyEl.reduce((a, l) => a + l.lagP50, 0) / Math.max(1, steadyEl.length)).toFixed(1) },
      serverRssMb: summarize(steadyEl.map((l) => l.rss)),
      postgresCpu: summarize(steadyPg.map((l) => Math.round(l.cpu))),
      pgConnections: { max: Math.max(0, ...pgConnSamples.map((s) => s.n)), activeMax: Math.max(0, ...pgConnSamples.map((s) => s.active)) },
      errors5xxOrNetwork: errors.length,
      lostSaves: lost,
      resurrectedDeletes: resurrected,
      badDeleteReplies: badDeleteReplies.length,
      readAfterWrite: raw,
      acknowledgedSaves: acks.size,
      runnerLoopLagMaxMs: Math.round(runnerLagMax),
    },
    routes: routeSummary,
    topQueries,
    errorsSample: errors.slice(0, 30),
    lostSample: lostList,
    browserErrors: browserResults.browserErrors.slice(0, 20),
    pageOpenSamples: browserResults.pageOpen,
    wallSeconds: Math.round((Date.now() - t00) / 1000),
  };
  writeFileSync(join(RUN_DIR, "summary.json"), JSON.stringify(summary, null, 1));
  writeFileSync(join(RUN_DIR, "server-samples.jsonl"), el.map((l) => JSON.stringify(l)).join("\n"));
  const t = summary.targets;
  const line = (name, s) => `| ${name} | ${s.n ?? ""} | ${s.p50 ?? ""} | ${s.p95 ?? ""} | ${s.p99 ?? ""} | ${s.max ?? ""} |`;
  const md = [
    `# Load run ${RUN_ID}`,
    "",
    `${USERS} simulated users, ${STEADY_S}s steady window, server on CPU ${SERVER_CPUS}, Postgres on CPU ${PG_CPUS}. ${new Date().toISOString()}`,
    "",
    "| metric | n | p50 | p95 | p99 | max |",
    "|---|---|---|---|---|---|",
    line("page open (browser reload, ms)", t.pageOpenMs),
    line("  employee (own filtered company)", t.pageOpenEmployeeMs),
    line("  editor (whole company)", t.pageOpenEditorMs),
    line("company load (ms)", t.companyLoadMs),
    line("tick (ms)", t.tickMs),
    line("save (ms)", t.saveMs),
    line("others see a save (ms)", t.othersSeeMs),
    line("server CPU % of one core (1 s samples)", t.serverCpu),
    line("Postgres CPU %", t.postgresCpu),
    "",
    `errors ${t.errors5xxOrNetwork}, lost saves ${t.lostSaves}, resurrected deletes ${t.resurrectedDeletes}, bad delete replies ${t.badDeleteReplies}, saves acked ${t.acknowledgedSaves}, others-see < 1 s ${t.othersSeeMs.under1s}`,
    `read-after-write: ${JSON.stringify(t.readAfterWrite)}`,
    `event-loop lag: ${JSON.stringify(t.serverLagMs)}; RSS MB ${JSON.stringify(t.serverRssMb)}; pg connections ${JSON.stringify(t.pgConnections)}; runner loop lag max ${t.runnerLoopLagMaxMs} ms`,
    "",
    "| route | n | p50 | p95 | p99 | max | avg bytes | status |",
    "|---|---|---|---|---|---|---|---|",
    ...Object.entries(routeSummary)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, s]) => `| ${k} | ${s.n} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} | ${s.bytesAvg} | ${JSON.stringify(s.status)} |`),
    "",
    "Top Postgres statements (steady window):",
    "",
    "| calls | total ms | mean ms | rows | query |",
    "|---|---|---|---|---|",
    ...topQueries.map((q) => `| ${q.calls} | ${q.total_ms} | ${q.mean_ms} | ${q.rows} | ${String(q.query).replace(/\|/g, "/")} |`),
    "",
  ].join("\n");
  writeFileSync(join(RUN_DIR, "summary.md"), md);
  console.log(md);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
