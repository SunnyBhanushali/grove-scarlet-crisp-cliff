#!/usr/bin/env node
/**
 * PERF: summarize a V8 .cpuprofile (node --cpu-prof).
 *   node scripts/load/profile-summary.mjs <file.cpuprofile> [--top=40] [--json=out.json]
 * Prints (1) self time by function, (2) inclusive time of the APMS source
 * functions (src/lib, server/, routes) — which request path the CPU went to.
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const top = Number((process.argv.find((a) => a.startsWith("--top=")) || "--top=40").split("=")[1]);
const jsonOut = (process.argv.find((a) => a.startsWith("--json=")) || "").split("=")[1];
const prof = JSON.parse(readFileSync(file, "utf8"));
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);

// Sample weights (µs) per node.
const self = new Map();
const deltas = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i];
  self.set(id, (self.get(id) || 0) + (deltas[i] || 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const label = (n) => {
  const f = n.callFrame;
  const url = (f.url || "").replace(/^file:\/\/.*\/\.output\/server\//, "").replace(/^file:\/\//, "");
  return `${f.functionName || "(anon)"} ${url ? url.split("/").slice(-2).join("/") : ""}:${f.lineNumber + 1}`;
};
const bySelf = new Map();
for (const [id, us] of self) {
  const k = label(nodes.get(id));
  bySelf.set(k, (bySelf.get(k) || 0) + us);
}
const idle = [...self].filter(([id]) => /\(idle\)|\(program\)/.test(nodes.get(id).callFrame.functionName)).reduce((a, [, us]) => a + us, 0);
const gc = [...self].filter(([id]) => nodes.get(id).callFrame.functionName === "(garbage collector)").reduce((a, [, us]) => a + us, 0);
const busy = total - idle;
const pctOf = (us) => ((100 * us) / busy).toFixed(1) + "%";

console.log(`profile ${file}`);
console.log(`wall ${(total / 1e6).toFixed(1)} s, busy ${(busy / 1e6).toFixed(1)} s (${((100 * busy) / total).toFixed(0)}% of one core), GC ${pctOf(gc)} of busy`);
console.log(`\n-- self time (share of busy) --`);
const selfRows = [...bySelf].sort((a, b) => b[1] - a[1]).slice(0, top);
for (const [k, us] of selfRows) console.log(pctOf(us).padStart(7), k);

// Inclusive time per app function: a sample counts once per distinct app frame on its stack.
const incl = new Map();
for (const [id, us] of self) {
  const seen = new Set();
  let cur = id;
  while (cur !== undefined) {
    const n = nodes.get(cur);
    const url = n.callFrame.url || "";
    if (/_chunks|_libs\/|_ssr|index\.mjs|routes|server\//.test(url) && !/node_modules/.test(url)) {
      const k = label(n);
      if (!seen.has(k)) {
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + us);
      }
    }
    cur = parent.get(cur);
  }
}
console.log(`\n-- inclusive time of app functions (share of busy) --`);
const inclRows = [...incl].sort((a, b) => b[1] - a[1]).slice(0, top);
for (const [k, us] of inclRows) console.log(pctOf(us).padStart(7), k);
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ file, wallS: total / 1e6, busyS: busy / 1e6, gcShare: gc / busy, self: selfRows.map(([k, us]) => [k, us / busy]), inclusive: inclRows.map(([k, us]) => [k, us / busy]) }, null, 1),
  );
}
