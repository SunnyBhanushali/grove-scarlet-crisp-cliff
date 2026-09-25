/**
 * MCP connector ⇄ SPA parity: runs the SHIPPED browser bundle's own score /
 * payout functions and the connector's server-side port (src/lib/apms-mcp/
 * scoring.ts) on the seed company and reports any difference.
 *
 *   node --experimental-strip-types scripts/mcp-bundle-parity.mjs
 *
 * Bound to login-view-f2j6t0x4-11a3-p0ar.js: its export aliases (Xt = _u
 * person-month payout, Or = nc plan scores, Ht = yu rewards year) change
 * whenever that bundle is rebuilt — update BUNDLE / the aliases then.
 * Result on p0as82/p0as83: 29 Rewards months, 53 APMS plans, 172 Rewards
 * years, 0 differences.
 */
import { readFileSync } from "node:fs";
const g = globalThis;
const noop = () => {};
const el = () => ({ style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop, removeEventListener: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, remove: noop, dataset: {} });
g.window = g; g.self = g;
g.document = { createElement: el, head: el(), body: el(), documentElement: el(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: noop, removeEventListener: noop, cookie: "", readyState: "complete", visibilityState: "visible" };
g.localStorage = g.sessionStorage = { getItem: () => null, setItem: noop, removeItem: noop };
g.addEventListener = noop; g.removeEventListener = noop; g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
g.location = new URL("https://apms.alienstattoo.in/apms.html");
g.history = { replaceState: noop, pushState: noop }; g.requestAnimationFrame = (f) => setTimeout(f, 0);
g.fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" });
g.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
g.EventSource = class { close() {} addEventListener() {} };
Object.defineProperty(g, "navigator", { value: { userAgent: "node", onLine: true }, configurable: true });
const B = await import(new URL("../public/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url).href);
const { readFileSync: r } = await import("node:fs");
const seed = JSON.parse(r(new URL("../src/lib/company-seed.json", import.meta.url), "utf8"));
const S = await import(new URL("../src/lib/apms-mcp/scoring.ts", import.meta.url).href);
let n = 0, diffs = 0;
for (const [month, m] of Object.entries(seed.rewardRecords)) {
  if (!/^\d{4}-\d{2}$/.test(month)) continue;
  for (const [pid, rec] of Object.entries(m || {})) {
    const person = seed.people.find((p) => p.id === pid); if (!person || !rec || !(rec.brands || rec.kras)) continue;
    const role = seed.roles[person.roleId];
    // bundle: _u(targetNodes, targetMembers, targetCells, businessUnits, gateUnits, gateMonths, person, rec, month, role)
    const bPay = B.Xt(seed.targetNodes || {}, seed.targetMembers || [], seed.targetCells || {}, seed.businessUnits, seed.gateUnits, seed.gateMonths, person, rec, month, role);
    const mine = S.personMonthPayout(seed, person, month);
    n++;
    const same = bPay.earned === mine.payout.earned && bPay.milestone === mine.payout.milestone && bPay.pot === mine.payout.pot && !!bPay.dq === mine.payout.dq;
    if (!same) { diffs++; console.log("DIFF", month, person.name, JSON.stringify(bPay), JSON.stringify(mine.payout)); }
  }
}
let an = 0, ad = 0;
for (const [month, m] of Object.entries(seed.records)) for (const [pid, rec] of Object.entries(m || {})) {
  if (!rec || !(rec.brands || rec.kras)) continue;
  const b = B.Or(rec); const mine = S.planScores(rec, S.scoreCtx(seed, month), seed.valuesCatalog); an++;
  if (b.p !== mine.p || b.kpi !== mine.kpi || b.exec !== mine.exec || b.values !== mine.values) { ad++; console.log("APMS DIFF", month, pid, JSON.stringify(b), JSON.stringify({kpi:mine.kpi,exec:mine.exec,values:mine.values,p:mine.p})); }
}
let yn = 0, yd = 0;
for (const person of seed.people) {
  if (!person.roleId) continue;
  const b = B.Ht(seed, person, "2026-08"); if (!b) continue;
  const mine = S.rewardsYear(seed, person, "2026-08"); yn++;
  if (b.year.total !== mine.year.total || b.year.paid !== mine.year.paid || b.quarters.some((q, i) => q.total !== mine.quarters[i].total)) { yd++; if (yd < 4) console.log("YEAR DIFF", person.name, b.year.total, mine.year.total, b.quarters.map(q=>q.total), mine.quarters.map(q=>q.total)); }
}
console.log(`Rewards months compared: ${n}, differences: ${diffs}`);
console.log(`APMS plans compared: ${an}, differences: ${ad}`);
console.log(`Rewards years compared: ${yn}, differences: ${yd}`);
process.exit(diffs + ad + yd ? 1 : 0);
