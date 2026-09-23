/**
 * Shared helpers for the three-user ROWS-V2 checks (scripts/e2e/rows-v2-three-users.mjs).
 *
 * A, B and C are three Playwright pages signed in as three different admins.
 * `ctx.sql` reads the server's Postgres directly, so every check compares what
 * the screens show with what the database holds.
 */
import pg from "pg";

export const LIVE_LIMIT_MS = 5000;
const FEED = /\/api\/(changes|company-tick|company-live)(\?|$)/;

export async function makeCtx({ A, B, C, base, databaseUrl }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const pages = { A, B, C };
  const net = { A: [], B: [], C: [] };
  const errs = { A: [], B: [], C: [] };
  for (const [tag, p] of Object.entries(pages)) attach(p, tag, base, net, errs);

  const ctx = {
    A, B, C, pages, base, net, errs,
    async sql(q, params = []) {
      const r = await pool.query(q, params);
      return r.rows;
    },
    async close() { await pool.end(); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    mark() {
      const at = Date.now();
      return {
        at,
        writes: (tag) => net[tag].filter((n) => n.t >= at && n.m !== "GET"),
        fives: (tag) => net[tag].filter((n) => n.t >= at && n.s >= 500),
        errors: (tag) => errs[tag].filter((e) => e.t >= at),
      };
    },
    /** Poll `fn` until it returns truthy; the elapsed ms, or null after `ms`. */
    async waitUntil(fn, ms = LIVE_LIMIT_MS, step = 200) {
      const t0 = Date.now();
      for (;;) {
        let ok = false;
        try { ok = await fn(); } catch { ok = false; }
        if (ok) return Date.now() - t0;
        if (Date.now() - t0 > ms) return null;
        await new Promise((r) => setTimeout(r, step));
      }
    },
    /** Wait until the page has nothing left to save (sync pendingOps empty). */
    async settled(p, ms = 15000) {
      let quiet = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const n = await p.evaluate(() => {
          const s = window.__apmsSync;
          const ops = s && typeof s.pendingOps === "function" ? s.pendingOps() : [];
          return ops ? ops.length : 0;
        }).catch(() => 0);
        quiet = n === 0 ? quiet + 1 : 0;
        if (quiet >= 3) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    },
    async banner(p) {
      return p.evaluate(() => {
        const body = document.body.innerText || "";
        const s = window.__apmsSync;
        const m = body.match(/[^\n]*(refresh to|lost to sync|changed by someone|reload to see|\bRefresh\b)[^\n]*/i);
        return {
          text: m ? m[0].slice(0, 120) : "",
          globalBar: s && typeof s.showGlobalConflictBar === "function" ? !!s.showGlobalConflictBar() : false,
          rowConflicts: s && typeof s.rowConflicts === "function" ? (s.rowConflicts() || []).length : 0,
        };
      });
    },
    async anyBanner() {
      const out = {};
      for (const [tag, p] of Object.entries(pages)) {
        const b = await ctx.banner(p);
        if (b.text || b.globalBar || b.rowConflicts) out[tag] = b;
      }
      return Object.keys(out).length ? out : null;
    },
    /** Hold a page's live feed so its screen provably stays stale. */
    async holdFeed(p) {
      const h = (r) => r.abort();
      p.__feedHold = h;
      await p.route(FEED, h);
    },
    async releaseFeed(p) {
      if (p.__feedHold) await p.unroute(FEED, p.__feedHold);
      p.__feedHold = null;
    },
    async text(p, sel = "main") {
      return (await p.locator(sel).first().innerText()).replace(/ /g, " ");
    },
    async nav(p, top, sub) {
      await p.locator("aside, nav").first().getByText(top, { exact: true }).first().click();
      await p.waitForTimeout(500);
      if (sub) {
        await p.locator("aside, nav").first().getByText(sub, { exact: true }).first().click();
      }
      await p.waitForTimeout(1200);
    },
    async reloadAll() {
      await Promise.all(Object.values(pages).map(async (p) => {
        await p.reload({ waitUntil: "load" });
        await p.locator("aside, nav").first().getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
      }));
      await new Promise((r) => setTimeout(r, 1500));
    },
    /** Modals are `div.fixed.inset-0` overlays; a click on the backdrop closes them. */
    async closeModal(p) {
      await p.mouse.click(6, 994);
      await p.waitForTimeout(300);
    },
  };
  return ctx;
}

function attach(p, tag, base, net, errs) {
  if (p.__e2eAttached) return;
  p.__e2eAttached = true;
  p.on("response", async (r) => {
    const req = r.request();
    const u = r.url().replace(base, "");
    if (!u.startsWith("/api/") && !u.startsWith("/_serverFn")) return;
    const m = req.method();
    if (m === "GET" && r.status() < 500) return;
    let body = "";
    try { body = (await r.text()).slice(0, 400); } catch { /* ignore */ }
    net[tag].push({ t: Date.now(), m, u: u.slice(0, 140), s: r.status(), req: (req.postData() || "").slice(0, 600), body });
  });
  p.on("pageerror", (e) => errs[tag].push({ t: Date.now(), msg: String((e && e.message) || e).slice(0, 200) }));
}

/** Writes that are not a person's edit: sign-in and auth traffic are excluded. */
export function realWrites(list) {
  return list.filter((n) => !/\/api\/(auth|issued-logins|provision-logins|session)/.test(n.u));
}

export function brief(list) {
  return list.map((n) => `${n.m} ${n.u.replace(/[?].*/, "")} ${n.s}`);
}

/**
 * Results for one screen: six checks, each pass / fail / n/a with a detail.
 * `n/a` is used only where a check cannot apply (e.g. a read-only view has
 * nothing to delete), and says why.
 */
export class ScreenResult {
  constructor(module, id, title) {
    this.module = module;
    this.id = id;
    this.title = title;
    this.checks = {};
    this.notes = [];
  }
  set(n, status, detail = "") {
    const prev = this.checks[n];
    // A later fail never gets overwritten by a pass for the same check.
    if (prev && prev.status === "fail" && status !== "fail") return;
    this.checks[n] = { status, detail };
    console.log(`  [${this.id}] check ${n}: ${status.toUpperCase()}${detail ? " — " + detail : ""}`);
  }
  pass(n, detail) { this.set(n, "pass", detail); }
  fail(n, detail) { this.set(n, "fail", detail); }
  na(n, detail) { this.set(n, "n/a", detail); }
  expect(n, ok, detail) { this.set(n, ok ? "pass" : "fail", detail); }
  note(s) { this.notes.push(s); console.log(`  [${this.id}] note: ${s}`); }
}
